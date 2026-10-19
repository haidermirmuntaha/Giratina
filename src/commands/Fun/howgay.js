import { SlashCommandBuilder } from 'discord.js';
import { successEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';

function randomPercent() {
    return Math.floor(Math.random() * 101);
}

function flavorText(percent) {
    if (percent >= 90) return 'Maximum rainbow energy detected. Purely random science.';
    if (percent >= 70) return 'Strong reading on the meter. 100% certified random.';
    if (percent >= 40) return 'A solid middle-of-the-road roll. Completely made up.';
    if (percent >= 15) return 'Barely registering. Still just a random number.';
    return 'Negligible reading. The dice said so.';
}

export default {
    data: new SlashCommandBuilder()
        .setName('howgay')
        .setDescription('Generate a random "gay rate" percentage for fun (not real science).')
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
            'Gay Rate 🌈',
            `**Target:** ${displayName}\n**Result:** **${percent}%**\n\n${flavorText(percent)}`,
        );

        await InteractionHelper.universalReply(interaction, { embeds: [embed] });
        logger.debug(`howgay executed by ${interaction.user.id} for ${targetUser.id}: ${percent}%`);
    },
};
