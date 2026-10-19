import { SlashCommandBuilder } from 'discord.js';
import { successEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';

function randomPercent() {
    return Math.floor(Math.random() * 101);
}

function flavorText(percent) {
    if (percent >= 90) return 'Off the charts. Scorching (according to pure RNG).';
    if (percent >= 70) return 'High heat reading. 100% certified random.';
    if (percent >= 40) return 'Solid mid-tier roll. Completely made up for the bit.';
    if (percent >= 15) return 'Mild warmth. The dice were playing it cool.';
    return 'Barely a spark. Still just a random number generator.';
}

export default {
    data: new SlashCommandBuilder()
        .setName('howhot')
        .setDescription('Generate a random "hot rate" percentage for fun (not real science).')
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
            'Hot Rate 🔥',
            `**Target:** ${displayName}\n**Result:** **${percent}%**\n\n${flavorText(percent)}`,
        );

        await InteractionHelper.universalReply(interaction, { embeds: [embed] });
        logger.debug(`howhot executed by ${interaction.user.id} for ${targetUser.id}: ${percent}%`);
    },
};
