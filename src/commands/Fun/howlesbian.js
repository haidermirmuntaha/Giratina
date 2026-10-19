import { SlashCommandBuilder } from 'discord.js';
import { successEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';

function randomPercent() {
    return Math.floor(Math.random() * 101);
}

function flavorText(percent) {
    if (percent >= 90) return 'Off the charts. Still 100% random entertainment.';
    if (percent >= 70) return 'High reading on the fun meter. Not real science.';
    if (percent >= 40) return 'Average roll. Completely made up for the bit.';
    if (percent >= 15) return 'Low signal. The RNG was feeling mild today.';
    return 'Almost nothing. Just a random number generator at work.';
}

export default {
    data: new SlashCommandBuilder()
        .setName('howlesbian')
        .setDescription('Generate a random "lesbian rate" percentage for fun (not real science).')
        .addUserOption((option) =>
            option
                .setName('user')
                .setDescription('Optional member to rate (defaults to you)')
                .setRequired(false),
        )
        .setDMPermission(false),

    prefixOnly: true,
    category: 'Fun',

    async execute(interaction, _config, _client) {
        const targetUser =
            interaction.options.getUser('user') ?? interaction.user;

        let displayName = targetUser.username;
        if (interaction.guild) {
            const member = interaction.guild.members.cache.get(targetUser.id)
                ?? await interaction.guild.members.fetch(targetUser.id).catch(() => null);
            if (member) {
                displayName = member.displayName;
            }
        }

        const percent = randomPercent();
        const embed = successEmbed(
            'Lesbian Rate 💜',
            `**Target:** ${displayName}\n**Result:** **${percent}%**\n\n${flavorText(percent)}`,
        );

        await InteractionHelper.universalReply(interaction, { embeds: [embed] });
        logger.debug(`howlesbian executed by ${interaction.user.id} for ${targetUser.id}: ${percent}%`);
    },
};
