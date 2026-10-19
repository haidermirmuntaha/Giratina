import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { setAfk } from '../../services/afkService.js';

// Prefix commands split their arguments on spaces, so the reason is every argument joined back up.
function readReason(interaction) {
    if (interaction._isPrefixCommand) {
        return (interaction.options._hoistedOptions ?? [])
            .map((option) => option.value)
            .join(' ');
    }
    return interaction.options.getString('reason') ?? '';
}

export default {
    data: new SlashCommandBuilder()
        .setName('afk')
        .setDescription('Set yourself as AFK. People who ping you will see your message.')
        .addStringOption((option) =>
            option
                .setName('reason')
                .setDescription('Why you are away')
                .setRequired(false)
                .setMaxLength(150),
        )
        .setDMPermission(false),

    // Prefix-only: not registered as a slash command (Discord caps bots at 100).
    prefixOnly: true,

    async execute(interaction, _config, _client) {
        if (!interaction.guild) {
            throw new TitanBotError(
                'AFK used outside a cached guild',
                ErrorTypes.VALIDATION,
                'This command can only be used in a server.',
            );
        }

        const status = await setAfk(
            interaction.guild.id,
            interaction.user.id,
            readReason(interaction),
            interaction.id ?? null,
        );

        if (!status) {
            throw new TitanBotError(
                'Failed to save AFK status',
                ErrorTypes.DATABASE,
                'I could not save your AFK status. Please try again in a moment.',
            );
        }

        await InteractionHelper.universalReply(interaction, {
            embeds: [
                createEmbed({
                    title: '💤 You are now AFK',
                    description: `**${status.reason}**\n\nI'll let people know when they ping you. Send any message to come back.`,
                    color: 'info',
                }),
            ],
        });
    },
};
