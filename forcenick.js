import { SlashCommandBuilder, PermissionFlagsBits, escapeMarkdown } from 'discord.js';
import { successEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { ModerationService } from '../../services/moderation/moderationService.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { logger } from '../../utils/logger.js';

const MAX_NICKNAME_LENGTH = 32;
const RESET_WORDS = new Set(['reset', 'clear']);

// Prefix commands split their arguments on spaces, so the nickname is every argument after the user.
function readNickname(interaction) {
    if (interaction._isPrefixCommand) {
        return (interaction.options._hoistedOptions ?? [])
            .slice(1)
            .map((option) => option.value)
            .join(' ')
            .trim();
    }
    return (interaction.options.getString('nickname') ?? '').trim();
}

export default {
    data: new SlashCommandBuilder()
        .setName('forcenick')
        .setDescription("Change a member's nickname (alias: fn)")
        .addUserOption((option) =>
            option
                .setName('user')
                .setDescription('The member whose nickname to change')
                .setRequired(true),
        )
        .addStringOption((option) =>
            option
                .setName('nickname')
                .setDescription('The new nickname (leave empty or type "reset" to remove it)')
                .setRequired(false)
                .setMaxLength(MAX_NICKNAME_LENGTH),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)
        .setDMPermission(false),

    // Prefix-only: not registered as a slash command (Discord caps bots at 100).
    prefixOnly: true,
    abuseProtection: { maxAttempts: 10, windowMs: 60_000 },

    async execute(interaction, _config, client) {
        const guild = interaction.guild;
        const moderator = interaction.member;

        if (!guild || !moderator) {
            throw new TitanBotError(
                'forcenick used outside a cached guild',
                ErrorTypes.VALIDATION,
                'This command can only be used in a server.',
            );
        }

        const targetUser = interaction.options.getUser('user');
        if (!targetUser?.id) {
            throw new TitanBotError(
                'Missing target user',
                ErrorTypes.USER_INPUT,
                'You must mention a member or give their ID.',
                { subtype: 'invalid_user' },
            );
        }

        const target = await guild.members.fetch(targetUser.id).catch(() => null);
        if (!target) {
            throw new TitanBotError(
                'Target not found',
                ErrorTypes.USER_INPUT,
                'I could not find that member in this server.',
                { subtype: 'user_not_found' },
            );
        }

        if (target.id === client.user.id) {
            throw new TitanBotError(
                'Cannot rename the bot',
                ErrorTypes.VALIDATION,
                'I cannot change my own nickname with this command.',
            );
        }

        if (target.id === guild.ownerId) {
            throw new TitanBotError(
                'Cannot rename the server owner',
                ErrorTypes.VALIDATION,
                "Discord doesn't allow anyone to change the server owner's nickname.",
            );
        }

        if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageNicknames)) {
            throw new TitanBotError(
                'Bot missing ManageNicknames',
                ErrorTypes.PERMISSION,
                'I need the **Manage Nicknames** permission to do that.',
            );
        }

        if (target.id !== moderator.id) {
            const moderatorCheck = ModerationService.validateHierarchy(moderator, target, 'nickname change');
            if (!moderatorCheck.valid) {
                throw new TitanBotError(
                    'Moderator hierarchy check failed',
                    ErrorTypes.PERMISSION,
                    moderatorCheck.error,
                );
            }
        }

        const botCheck = ModerationService.validateBotHierarchy(target, 'nickname change');
        if (!botCheck.valid) {
            throw new TitanBotError(
                'Bot hierarchy check failed',
                ErrorTypes.PERMISSION,
                botCheck.error,
            );
        }

        const requested = readNickname(interaction);
        const isReset = !requested || RESET_WORDS.has(requested.toLowerCase());

        if (!isReset && requested.length > MAX_NICKNAME_LENGTH) {
            throw new TitanBotError(
                'Nickname too long',
                ErrorTypes.VALIDATION,
                `Nicknames can be at most ${MAX_NICKNAME_LENGTH} characters. That one is ${requested.length}.`,
            );
        }

        const previousNickname = target.nickname;
        const auditReason = `Nickname ${isReset ? 'reset' : 'changed'} by ${moderator.user.tag} (${moderator.id})`;

        try {
            await target.setNickname(isReset ? null : requested, auditReason);
        } catch (error) {
            logger.warn('Failed to set nickname', {
                guildId: guild.id,
                targetId: target.id,
                moderatorId: moderator.id,
                error: error.message,
            });
            throw new TitanBotError(
                `Failed to set nickname: ${error.message}`,
                ErrorTypes.DISCORD_API,
                'Discord refused the nickname change. Check that my role is above the member and try again.',
            );
        }

        logger.info('Nickname changed via forcenick', {
            guildId: guild.id,
            targetId: target.id,
            moderatorId: moderator.id,
            reset: isReset,
        });

        const before = previousNickname ? escapeMarkdown(previousNickname) : '*none*';
        const after = isReset ? '*none (reset)*' : escapeMarkdown(requested);

        await InteractionHelper.universalReply(interaction, {
            embeds: [
                successEmbed(
                    '✏️ Nickname Updated',
                    `**Member:** <@${target.id}>\n**Before:** ${before}\n**After:** ${after}`,
                ),
            ],
        });
    },
};
