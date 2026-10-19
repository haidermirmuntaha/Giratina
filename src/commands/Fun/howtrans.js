import { SlashCommandBuilder } from 'discord.js';
import { successEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';

function randomPercent() {
    return Math.floor(Math.random() * 101);
}

function flavorText(percent) {
    if (percent >= 90) return 'Maximum meter spike. Purely random, zero diagnostic value.';
    if (percent >= 70) return 'Strong fun-meter reading. Not a real assessment.';
    if (percent >= 40) return 'Mid-range roll. Entertainment only.';
    if (percent >= 15) return 'Quiet reading. The dice were feeling reserved.';
    return 'Barely a blip. Just RNG doing RNG things.';
}

export default {
    data: new SlashCommandBuilder()
        .setName('howtrans')
        .setDescription('Generate a random "trans rate" percentage for fun (not real science).')
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
            'Trans Rate 🏳️‍⚧️',
            `**Target:** ${displayName}\n**Result:** **${percent}%**\n\n${flavorText(percent)}`,
        );

        await InteractionHelper.universalReply(interaction, { embeds: [embed] });
        logger.debug(`howtrans executed by ${interaction.user.id} for ${targetUser.id}: ${percent}%`);
    },
};
