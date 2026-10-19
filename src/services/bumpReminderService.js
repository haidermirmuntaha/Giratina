/**
 * DISBOARD bump reminder service.
 *
 * Detects successful DISBOARD /bump confirmations, persists the last bump
 * timestamp in guild config (PostgreSQL JSONB), and sends a reminder when the
 * 2-hour cooldown expires. Designed to survive Railway restarts/redeployments
 * and to avoid duplicate reminders.
 *
 * This service NEVER executes, simulates, or automates DISBOARD's /bump command.
 * A human must perform the bump manually.
 */

import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { getGuildConfig, setGuildConfig } from './config/guildConfig.js';
import { logger } from '../utils/logger.js';
import { TIME } from '../utils/constants.js';
import { getColor } from '../config/bot.js';

/** Official DISBOARD application user ID */
export const DISBOARD_BOT_ID = '302050872383242240';

/** DISBOARD free-tier cooldown between successful bumps */
export const BUMP_COOLDOWN_MS = 2 * TIME.HOUR;

/**
 * Patterns that indicate a successful DISBOARD bump confirmation.
 * English "Bump done!" is the primary signal; Japanese listing-order text is included
 * for servers that use the Japanese DISBOARD locale.
 */
const SUCCESS_PATTERNS = [
  /bump\s*done/i,
  /表示順をアップしたよ/,
];

/**
 * Returns true if the message is a successful DISBOARD bump confirmation.
 * @param {import('discord.js').Message} message
 */
export function isSuccessfulDisboardBump(message) {
  if (!message?.author || message.author.id !== DISBOARD_BOT_ID) {
    return false;
  }
  if (!message.guild) {
    return false;
  }

  const embed = message.embeds?.[0];
  const candidates = [
    embed?.description,
    embed?.title,
    message.content,
  ].filter((v) => typeof v === 'string' && v.length > 0);

  if (candidates.length === 0) {
    return false;
  }

  const combined = candidates.join('\n');
  return SUCCESS_PATTERNS.some((re) => re.test(combined));
}

/**
 * Persist a successful bump for the guild and reset the reminder marker so a
 * new cycle can fire when the cooldown expires.
 *
 * @param {import('discord.js').Client} client
 * @param {string} guildId
 * @param {Date|string|number} [bumpTime]
 */
export async function recordSuccessfulBump(client, guildId, bumpTime = new Date()) {
  const iso =
    bumpTime instanceof Date
      ? bumpTime.toISOString()
      : new Date(bumpTime).toISOString();

  if (Number.isNaN(Date.parse(iso))) {
    logger.warn('recordSuccessfulBump: invalid bumpTime', { guildId, bumpTime });
    return null;
  }

  const config = await getGuildConfig(client, guildId);
  config.lastBumpAt = iso;
  // Clear previous reminder marker so this bump cycle can produce one reminder.
  config.lastBumpReminderFor = null;
  await setGuildConfig(client, guildId, config);

  logger.info('Recorded successful DISBOARD bump', {
    guildId,
    lastBumpAt: iso,
  });

  return config;
}

/**
 * Handle an incoming message that may be a DISBOARD bump confirmation.
 * Safe to call for every message; no-ops when not a successful bump.
 *
 * @param {import('discord.js').Message} message
 * @param {import('discord.js').Client} client
 */
export async function handleDisboardBumpMessage(message, client) {
  try {
    if (!isSuccessfulDisboardBump(message)) {
      return false;
    }

    if (!client?.db) {
      logger.warn('DISBOARD bump detected but database unavailable; cannot persist', {
        guildId: message.guild?.id,
      });
      return false;
    }

    const guildId = message.guild.id;
    const config = await getGuildConfig(client, guildId);

    // Only track bumps when the feature is enabled (channel configured or explicitly enabled).
    if (config.bumpEnabled === false && !config.bumpChannelId) {
      logger.debug('DISBOARD bump detected but bump reminder is not configured', { guildId });
      return false;
    }

    await recordSuccessfulBump(client, guildId, message.createdAt ?? new Date());
    return true;
  } catch (error) {
    logger.error('Error handling DISBOARD bump message', {
      guildId: message.guild?.id,
      error: error?.message || error,
    });
    return false;
  }
}

/**
 * Compute when the next reminder is due for a guild config.
 * @param {{ lastBumpAt?: string|null }} config
 * @returns {Date|null}
 */
export function getReminderDueAt(config) {
  if (!config?.lastBumpAt) {
    return null;
  }
  const last = Date.parse(config.lastBumpAt);
  if (Number.isNaN(last)) {
    return null;
  }
  return new Date(last + BUMP_COOLDOWN_MS);
}

/**
 * Whether a reminder should be sent for the current bump cycle.
 * Uses lastBumpReminderFor === lastBumpAt to avoid duplicates after restarts.
 */
export function shouldSendReminder(config, now = Date.now()) {
  if (!config) return false;
  if (config.bumpEnabled === false) return false;
  if (!config.bumpChannelId) return false;
  if (!config.lastBumpAt) return false;

  const dueAt = getReminderDueAt(config);
  if (!dueAt || now < dueAt.getTime()) {
    return false;
  }

  // Already reminded for this exact bump cycle.
  if (config.lastBumpReminderFor && config.lastBumpReminderFor === config.lastBumpAt) {
    return false;
  }

  return true;
}

/**
 * Send the bump reminder embed (and optional role ping) to the configured channel.
 * Handles missing channel, missing permissions, and send failures gracefully.
 *
 * @returns {Promise<boolean>} true if a reminder was sent and marked
 */
export async function sendBumpReminder(client, guild, config) {
  const channelId = config.bumpChannelId;
  if (!channelId) {
    return false;
  }

  let channel = guild.channels.cache.get(channelId) ?? null;
  if (!channel) {
    try {
      channel = await guild.channels.fetch(channelId);
    } catch {
      channel = null;
    }
  }

  if (!channel || !channel.isTextBased?.()) {
    logger.warn('Bump reminder channel missing or not text-based; skipping', {
      guildId: guild.id,
      channelId,
    });
    return false;
  }

  const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
  if (me) {
    const perms = channel.permissionsFor(me);
    if (
      !perms?.has(PermissionFlagsBits.ViewChannel) ||
      !perms?.has(PermissionFlagsBits.SendMessages)
    ) {
      logger.warn('Missing permissions to send bump reminder', {
        guildId: guild.id,
        channelId,
      });
      return false;
    }
  }

  const dueAt = getReminderDueAt(config);
  const overdue = dueAt && Date.now() > dueAt.getTime() + 60_000;

  const embed = new EmbedBuilder()
    .setColor(getColor('info') || 0x5865f2)
    .setTitle(overdue ? 'Bump reminder (overdue)' : 'Time to bump!')
    .setDescription(
      [
        'The DISBOARD 2-hour cooldown has ended.',
        'A human should run **`/bump`** with the DISBOARD bot when ready.',
        '',
        '_This bot never runs `/bump` for you._',
      ].join('\n')
    )
    .setFooter({ text: 'DISBOARD bump reminder' })
    .setTimestamp(dueAt || new Date());

  if (config.lastBumpAt) {
    embed.addFields({
      name: 'Last successful bump',
      value: `<t:${Math.floor(Date.parse(config.lastBumpAt) / 1000)}:R>`,
      inline: true,
    });
  }

  let content;
  if (config.bumpRoleId) {
    const role = guild.roles.cache.get(config.bumpRoleId);
    if (role) {
      content = `<@&${config.bumpRoleId}>`;
    }
  }

  try {
    await channel.send({
      content: content || undefined,
      embeds: [embed],
      allowedMentions: config.bumpRoleId
        ? { roles: [config.bumpRoleId] }
        : { parse: [] },
    });
  } catch (error) {
    logger.warn('Failed to send bump reminder message', {
      guildId: guild.id,
      channelId,
      error: error?.message || error,
    });
    return false;
  }

  // Mark this bump cycle as reminded so restarts do not re-send.
  try {
    const latest = await getGuildConfig(client, guild.id);
    latest.lastBumpReminderFor = latest.lastBumpAt || config.lastBumpAt;
    await setGuildConfig(client, guild.id, latest);
  } catch (error) {
    logger.error('Sent bump reminder but failed to persist lastBumpReminderFor', {
      guildId: guild.id,
      error: error?.message || error,
    });
    // Still return true — message was delivered; worst case a restart could re-send once.
  }

  logger.info('Sent DISBOARD bump reminder', {
    guildId: guild.id,
    channelId,
    overdue: Boolean(overdue),
  });

  return true;
}

/**
 * Cron entry point: scan all guilds the bot is in and send any due reminders.
 * Safe under concurrent restarts because lastBumpReminderFor is written after send.
 *
 * @param {import('discord.js').Client} client
 */
export async function checkBumpReminders(client) {
  try {
    if (!client?.db) {
      logger.debug('Database not available for bump reminder check');
      return;
    }

    const now = Date.now();
    let sent = 0;
    let scanned = 0;

    for (const [guildId, guild] of client.guilds.cache) {
      try {
        const config = await getGuildConfig(client, guildId);
        scanned += 1;

        if (!shouldSendReminder(config, now)) {
          continue;
        }

        const ok = await sendBumpReminder(client, guild, config);
        if (ok) {
          sent += 1;
        }
      } catch (error) {
        logger.error(`Error checking bump reminder for guild ${guildId}`, {
          error: error?.message || error,
        });
      }
    }

    if (sent > 0) {
      logger.info(`Bump reminder check: scanned ${scanned} guild(s), sent ${sent}`);
    }
  } catch (error) {
    logger.error('Error in checkBumpReminders', { error: error?.message || error });
  }
}

/**
 * Format remaining cooldown for status displays.
 * @param {{ lastBumpAt?: string|null }} config
 * @returns {{ ready: boolean, remainingMs: number, dueAt: Date|null }}
 */
export function getBumpStatus(config) {
  const dueAt = getReminderDueAt(config);
  if (!dueAt) {
    return { ready: true, remainingMs: 0, dueAt: null };
  }
  const remainingMs = Math.max(0, dueAt.getTime() - Date.now());
  return {
    ready: remainingMs === 0,
    remainingMs,
    dueAt,
  };
}
