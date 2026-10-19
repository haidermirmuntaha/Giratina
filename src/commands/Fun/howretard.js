import { SlashCommandBuilder } from 'discord.js';
import { successEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';

function randomPercent() {
    return Math.floor(Math.random() * 101);
}

function flavorText(percent) {
    if (percent >= 90) return 'Peak chaos mode unlocked. Still just a random number.';
    if (percent >= 70) return 'High silly energy. 100% certified nonsense.';
    if (percent >= 40) return 'Average silliness. Completely made up for laughs.';
    if (percent >= 15) return 'Mild goof levels. The RNG was being gentle.';
    return 'Almost serious. Almost. Still pure random entertainment.';
}

export default {
    data: new SlashCommandBuilder()
        .setName('howretard')
        .setDescription('Generate a random "silly rate" percentage for fun (not a real judgment).')
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
        // Playful label only — never uses the command name as an insult toward the target.
        const embed = successEmbed(
            'Silly Rate 🤪',
            `**Target:** ${displayName}\n**Result:** **${percent}%**\n\n${flavorText(percent)}`,
        );

        await InteractionHelper.universalReply(interaction, { embeds: [embed] });
        logger.debug(`howretard executed by ${interaction.user.id} for ${targetUser.id}: ${percent}%`);
    },
};
