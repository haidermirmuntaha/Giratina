import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { getGuildConfig, setGuildConfig } from '../../services/config/guildConfig.js';
import {
  getBumpStatus,
  BUMP_COOLDOWN_MS,
} from '../../services/bumpReminderService.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';
import { getColor } from '../../config/bot.js';

function formatDuration(ms) {
  if (ms <= 0) return 'ready now';
  const totalSec = Math.ceil(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s && !h) parts.push(`${s}s`);
  return parts.join(' ') || '0s';
}

export default {
  data: new SlashCommandBuilder()
    .setName('bump')
    .setDescription('Configure and view the DISBOARD bump reminder')
    .addSubcommand((sub) =>
      sub
        .setName('setup')
        .setDescription('Enable the bump reminder (Manage Server required)')
        .addChannelOption((opt) =>
          opt
            .setName('channel')
            .setDescription('Channel for bump reminders')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true)
        )
        .addRoleOption((opt) =>
          opt
            .setName('role')
            .setDescription('Optional role to ping when a bump is due')
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('channel')
        .setDescription('Set or clear the reminder channel (Manage Server required)')
        .addChannelOption((opt) =>
          opt
            .setName('channel')
            .setDescription('Text channel for reminders. Omit to clear.')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('role')
        .setDescription('Set or clear the role to ping (Manage Server required)')
        .addRoleOption((opt) =>
          opt
            .setName('role')
            .setDescription('Role to ping when a bump is due. Omit to clear.')
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('disable')
        .setDescription('Disable bump reminders for this server (Manage Server required)')
    )
    .addSubcommand((sub) =>
      sub
        .setName('status')
        .setDescription('Show bump reminder status and cooldown')
    ),

  async execute(interaction, config, client) {
    const sub = interaction.options.getSubcommand();
    const needsManage = ['setup', 'channel', 'role', 'disable'].includes(sub);

    if (needsManage && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      const embed = new EmbedBuilder()
        .setColor(getColor('error') || 0xff0000)
        .setTitle('Permission denied')
        .setDescription('You need **Manage Server** to change bump reminder settings.');
      return InteractionHelper.safeReply(interaction, {
        embeds: [embed],
        flags: MessageFlags.Ephemeral,
      });
    }

    try {
      const guildId = interaction.guildId;
      const guildConfig = await getGuildConfig(client, guildId);

      if (sub === 'setup') {
        const channel = interaction.options.getChannel('channel');
        const role = interaction.options.getRole('role');

        guildConfig.bumpChannelId = channel.id;
        guildConfig.bumpRoleId = role?.id ?? null;
        guildConfig.bumpEnabled = true;
        await setGuildConfig(client, guildId, guildConfig);

        const embed = new EmbedBuilder()
          .setColor(getColor('success') || 0x57f287)
          .setTitle('Bump reminder enabled')
          .setDescription(
            [
              `Reminders will be posted in ${channel}${role ? ` and ping ${role}` : ''}.`,
              '',
              'When DISBOARD confirms a successful **`/bump`**, a 2-hour countdown starts.',
              'When it ends, a reminder is sent here. This bot never runs `/bump` for you.',
            ].join('\n')
          );
        return InteractionHelper.safeReply(interaction, {
          embeds: [embed],
          flags: MessageFlags.Ephemeral,
        });
      }

      if (sub === 'channel') {
        const channel = interaction.options.getChannel('channel');
        if (channel) {
          guildConfig.bumpChannelId = channel.id;
          guildConfig.bumpEnabled = true;
          await setGuildConfig(client, guildId, guildConfig);
          const embed = new EmbedBuilder()
            .setColor(getColor('success') || 0x57f287)
            .setTitle('Bump channel updated')
            .setDescription(`Bump reminders will be posted in ${channel}.`);
          return InteractionHelper.safeReply(interaction, {
            embeds: [embed],
            flags: MessageFlags.Ephemeral,
          });
        }

        guildConfig.bumpChannelId = null;
        guildConfig.bumpEnabled = false;
        await setGuildConfig(client, guildId, guildConfig);
        const embed = new EmbedBuilder()
          .setColor(getColor('warning') || 0xfee75c)
          .setTitle('Bump channel cleared')
          .setDescription('No reminder channel is set. Bump reminders are disabled until you set a channel again.');
        return InteractionHelper.safeReply(interaction, {
          embeds: [embed],
          flags: MessageFlags.Ephemeral,
        });
      }

      if (sub === 'role') {
        const role = interaction.options.getRole('role');
        guildConfig.bumpRoleId = role?.id ?? null;
        await setGuildConfig(client, guildId, guildConfig);

        const embed = new EmbedBuilder()
          .setColor(getColor('success') || 0x57f287)
          .setTitle(role ? 'Bump role updated' : 'Bump role cleared')
          .setDescription(
            role
              ? `Reminders will ping ${role}.`
              : 'No role will be pinged with bump reminders.'
          );
        return InteractionHelper.safeReply(interaction, {
          embeds: [embed],
          flags: MessageFlags.Ephemeral,
        });
      }

      if (sub === 'disable') {
        guildConfig.bumpEnabled = false;
        await setGuildConfig(client, guildId, guildConfig);
        const embed = new EmbedBuilder()
          .setColor(getColor('warning') || 0xfee75c)
          .setTitle('Bump reminders disabled')
          .setDescription(
            'Reminders are turned off. Existing last-bump data is kept so you can re-enable later without losing the cooldown.'
          );
        return InteractionHelper.safeReply(interaction, {
          embeds: [embed],
          flags: MessageFlags.Ephemeral,
        });
      }

      // status
      const status = getBumpStatus(guildConfig);
      const channelMention = guildConfig.bumpChannelId
        ? `<#${guildConfig.bumpChannelId}>`
        : '`not set`';
      const roleMention = guildConfig.bumpRoleId
        ? `<@&${guildConfig.bumpRoleId}>`
        : '`none`';
      const lastBump = guildConfig.lastBumpAt
        ? `<t:${Math.floor(Date.parse(guildConfig.lastBumpAt) / 1000)}:R>`
        : '`never recorded`';
      const nextLine = status.dueAt
        ? status.ready
          ? '**Ready** — a human can run `/bump` on DISBOARD'
          : `in **${formatDuration(status.remainingMs)}** (<t:${Math.floor(status.dueAt.getTime() / 1000)}:R>)`
        : '`no bump recorded yet`';

      const embed = new EmbedBuilder()
        .setColor(getColor('info') || 0x5865f2)
        .setTitle('DISBOARD bump reminder status')
        .addFields(
          {
            name: 'Enabled',
            value: guildConfig.bumpEnabled && guildConfig.bumpChannelId ? 'Yes' : 'No',
            inline: true,
          },
          { name: 'Channel', value: channelMention, inline: true },
          { name: 'Ping role', value: roleMention, inline: true },
          { name: 'Last successful bump', value: lastBump, inline: true },
          { name: 'Next reminder', value: nextLine, inline: true },
          {
            name: 'Cooldown',
            value: `${Math.round(BUMP_COOLDOWN_MS / (60 * 1000))} minutes`,
            inline: true,
          }
        )
        .setFooter({
          text: 'This bot only reminds. A human must run /bump on DISBOARD.',
        });

      return InteractionHelper.safeReply(interaction, {
        embeds: [embed],
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      logger.error('bump command error:', error);
      const embed = new EmbedBuilder()
        .setColor(getColor('error') || 0xff0000)
        .setTitle('Configuration error')
        .setDescription('Could not update or read bump reminder settings. Please try again.');
      return InteractionHelper.safeReply(interaction, {
        embeds: [embed],
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
