import { getFromDb, setInDb, deleteFromDb, getAFKKey } from '../utils/database.js';
import { createEmbed } from '../utils/embeds.js';
import { logger } from '../utils/logger.js';

const DEFAULT_REASON = 'AFK';
const MAX_REASON_LENGTH = 150;
const MAX_NOTICES_PER_MESSAGE = 5;
const CACHE_TTL_MS = 5 * 60 * 1000;
const NOTICE_THROTTLE_MS = 15 * 1000;
const WELCOME_BACK_DELETE_MS = 10 * 1000;
const MAX_TRACKED_ENTRIES = 2000;

// guildId:userId -> { value: status|null, at: timestamp }
// Keeps us from hitting the database for every single message in every server.
const statusCache = new Map();
// channelId:afkUserId -> timestamp of the last notice, so repeated pings don't spam
const noticeThrottle = new Map();

function cacheKey(guildId, userId) {
    return `${guildId}:${userId}`;
}

function toMillis(value) {
    if (value == null) return null;
    const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
    return Number.isNaN(ms) ? null : ms;
}

function normalizeStatus(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const expiresAt = toMillis(raw.expiresAt ?? raw.expires_at);
    if (expiresAt && expiresAt <= Date.now()) return null;

    const reason = typeof raw.reason === 'string' && raw.reason.trim()
        ? raw.reason.trim()
        : DEFAULT_REASON;

    return {
        reason,
        since: toMillis(raw.setAt ?? raw.since) ?? Date.now(),
    };
}

function trimMap(map, maxEntries) {
    if (map.size <= maxEntries) return;
    const overflow = map.size - maxEntries;
    let removed = 0;
    for (const key of map.keys()) {
        map.delete(key);
        if (++removed >= overflow) break;
    }
}

export function sanitizeReason(input) {
    const cleaned = String(input ?? '').replace(/\s+/g, ' ').trim();
    if (!cleaned) return DEFAULT_REASON;
    return cleaned.length > MAX_REASON_LENGTH
        ? `${cleaned.slice(0, MAX_REASON_LENGTH - 1)}…`
        : cleaned;
}

export async function getAfkStatus(guildId, userId) {
    const key = cacheKey(guildId, userId);
    const hit = statusCache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
        return hit.value;
    }

    const raw = await getFromDb(getAFKKey(guildId, userId), null);
    const value = normalizeStatus(raw);
    statusCache.set(key, { value, at: Date.now() });
    trimMap(statusCache, MAX_TRACKED_ENTRIES);
    return value;
}

/**
 * @param {string} guildId
 * @param {string} userId
 * @param {string} reason
 * @param {string|null} sourceMessageId - the message that set the status, so the same
 *   message doesn't immediately clear it again
 * @returns {Promise<{reason: string, since: number}|null>} null when saving failed
 */
export async function setAfk(guildId, userId, reason, sourceMessageId = null) {
    const cleanReason = sanitizeReason(reason);
    const now = Date.now();

    const saved = await setInDb(getAFKKey(guildId, userId), {
        reason: cleanReason,
        setAt: now,
        expiresAt: null,
    });

    if (!saved) return null;

    const value = { reason: cleanReason, since: now, sourceMessageId };
    statusCache.set(cacheKey(guildId, userId), { value, at: now });
    trimMap(statusCache, MAX_TRACKED_ENTRIES);
    return value;
}

export async function clearAfk(guildId, userId) {
    const removed = await deleteFromDb(getAFKKey(guildId, userId));
    statusCache.set(cacheKey(guildId, userId), { value: null, at: Date.now() });
    return removed;
}

function formatDuration(ms) {
    const totalMinutes = Math.floor(ms / 60000);
    if (totalMinutes < 1) return 'less than a minute';

    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;

    const parts = [];
    if (days) parts.push(`${days}d`);
    if (hours) parts.push(`${hours}h`);
    if (minutes && !days) parts.push(`${minutes}m`);
    return parts.join(' ');
}

async function sendTemporary(message, payload, deleteAfterMs) {
    const sent = await message
        .reply({ ...payload, allowedMentions: { parse: [], repliedUser: false } })
        .catch(() => message.channel
            .send({ ...payload, allowedMentions: { parse: [] } })
            .catch(() => null));

    if (sent && deleteAfterMs) {
        setTimeout(() => sent.delete().catch(() => {}), deleteAfterMs);
    }
    return sent;
}

async function handleReturningUser(message) {
    const { guild, author } = message;
    const status = await getAfkStatus(guild.id, author.id);
    if (!status) return;

    // The message that set the AFK status must not clear it.
    if (status.sourceMessageId && status.sourceMessageId === message.id) return;

    await clearAfk(guild.id, author.id);

    const embed = createEmbed({
        title: '👋 Welcome back!',
        description: `I removed your AFK status. You were away for **${formatDuration(Date.now() - status.since)}**.`,
        color: 'success',
    });

    await sendTemporary(message, { embeds: [embed] }, WELCOME_BACK_DELETE_MS);
}

async function handleMentionedAfkUsers(message) {
    const { guild, author } = message;
    if (!message.mentions?.users?.size) return;

    const candidates = [...message.mentions.users.values()]
        .filter((user) => !user.bot && user.id !== author.id)
        .slice(0, MAX_NOTICES_PER_MESSAGE);

    if (candidates.length === 0) return;

    const now = Date.now();
    const lines = [];

    for (const user of candidates) {
        const status = await getAfkStatus(guild.id, user.id);
        if (!status) continue;

        const throttleKey = `${message.channel.id}:${user.id}`;
        const lastNotice = noticeThrottle.get(throttleKey) ?? 0;
        if (now - lastNotice < NOTICE_THROTTLE_MS) continue;

        noticeThrottle.set(throttleKey, now);
        lines.push(`💤 <@${user.id}> is AFK: **${status.reason}** — <t:${Math.floor(status.since / 1000)}:R>`);
    }

    trimMap(noticeThrottle, MAX_TRACKED_ENTRIES);

    if (lines.length === 0) return;

    const embed = createEmbed({
        description: lines.join('\n'),
        color: 'info',
    });

    await sendTemporary(message, { embeds: [embed] }, null);
}

/**
 * Called from messageCreate for every guild message from a human.
 * Clears AFK when the author speaks and announces AFK members who get pinged.
 */
export async function handleAfkMessage(message) {
    try {
        if (!message.guild || message.author.bot) return;

        await handleReturningUser(message);
        await handleMentionedAfkUsers(message);
    } catch (error) {
        logger.error('Error handling AFK message:', error);
    }
}
