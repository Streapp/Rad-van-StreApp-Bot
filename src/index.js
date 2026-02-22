require('dotenv').config();

const fs = require('fs');
const path = require('path');

const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

const TICKETS_CATEGORY_ID = process.env.TICKETS_CATEGORY_ID;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;
const SPEL_CATEGORY_ID = process.env.SPEL_CATEGORY_ID;
const ADMIN_CATEGORY_ID = process.env.ADMIN_CATEGORY_ID;

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'speldata.json');

client.once('clientReady', () => {
  console.log(`Bot is online als ${client.user.tag}`);
});

// crash prevent
process.on('unhandledRejection', (err) => console.error('UnhandledRejection:', err));
process.on('uncaughtException', (err) => console.error('UncaughtException:', err));
client.on('error', (err) => console.error('Client error:', err));

/* ---------------- Data storage ---------------- */

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '{}', 'utf8');
}

function loadData() {
  ensureDataFile();
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveData(data) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function getOrCreateGame(data, guildId, spelNummer) {
  if (!data[guildId]) data[guildId] = {};
  if (!data[guildId][spelNummer]) {
    data[guildId][spelNummer] = {
      taakSpots: { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0, "6": 0, "7": 0, "8": 0, "9": 0 },
      deelnemers: {},
      taakCounts: { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0, "6": 0, "7": 0, "8": 0, "9": 0 },
      dashboard: { channelId: null, messageId: null },
      ui: { tasksChannelId: null, tasksMessageId: null },
      adminDashboard: { channelId: null, messageId: null },
      adminChannelId: null,
      closed: false,
      closedAt: null,
    };
  }
  return data[guildId][spelNummer];
}

/* ---------------- Helpers ---------------- */

function getSpelNummerUitKanaalnaam(channelName) {
  const match = channelName.match(/spel-(\d+)/i);
  return match ? match[1] : null;
}

function findSpelRole(guild, spelNummer) {
  const candidates = [`Spel ${spelNummer}`, `Spel-${spelNummer}`, `spel ${spelNummer}`, `spel-${spelNummer}`];
  for (const name of candidates) {
    const role = guild.roles.cache.find((r) => r.name === name);
    if (role) return role;
  }
  const lowerCandidates = candidates.map((c) => c.toLowerCase());
  return guild.roles.cache.find((r) => lowerCandidates.includes(r.name.toLowerCase())) || null;
}

function hasAdminPermission(interaction) {
  return interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageMessages);
}

async function dmUserSafe(user, message) {
  try {
    await user.send(message);
    return true;
  } catch {
    return false;
  }
}

function formatTimestamp(date) {
  const unix = Math.floor(date.getTime() / 1000);
  return `<t:${unix}:F>`;
}

async function logToChannel(guild, message) {
  if (!LOG_CHANNEL_ID) return;
  const logChannel = await guild.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
  if (!logChannel || !logChannel.isTextBased()) return;
  await logChannel.send(message).catch(() => {});
}

function createTaakKnoppen(disabled = false) {
  const rows = [];
  let taakNummer = 1;
  for (let i = 0; i < 3; i++) {
    const row = new ActionRowBuilder();
    for (let j = 0; j < 3; j++) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`taak_${taakNummer}`)
          .setLabel(`Taak ${taakNummer}`)
          .setStyle(ButtonStyle.Primary)
          .setDisabled(disabled)
      );
      taakNummer++;
    }
    rows.push(row);
  }
  return rows;
}

function createAdminActieKnoppen() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_goedkeuren').setLabel('Goedkeuren').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('ticket_afkeuren').setLabel('Afkeuren').setStyle(ButtonStyle.Danger)
  );
}

/* ---------------- NEW: confirm/cancel before ticket creation ---------------- */

function createTaakConfirmKnoppen(spelNummer, taakNummer) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`taak_confirm:${spelNummer}:${taakNummer}`)
      .setLabel('✅ Ticket openen')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`taak_cancel:${spelNummer}:${taakNummer}`)
      .setLabel('❌ Annuleren')
      .setStyle(ButtonStyle.Secondary)
  );
}

function parseTicketTopic(topic) {
  if (!topic) return null;
  const spelMatch = topic.match(/Spel\s+(\d+)/i);
  const taakMatch = topic.match(/Taak\s+(\d+)/i);
  const userMatch = topic.match(/User\s+(\d+)/i);
  if (!spelMatch || !taakMatch || !userMatch) return null;
  return { spelNummer: spelMatch[1], taakNummer: taakMatch[1], userId: userMatch[1] };
}

function buildAfkeurModal(channelId) {
  const modal = new ModalBuilder().setCustomId(`afkeur_reason:${channelId}`).setTitle('Ticket afkeuren');

  const reasonInput = new TextInputBuilder()
    .setCustomId('reason')
    .setLabel('Reden (komt in DM + log)')
    .setStyle(TextInputStyle.Paragraph)
    .setMinLength(2)
    .setMaxLength(800)
    .setPlaceholder('Bijv: bewijs is onduidelijk / geen URL of screenshot / taak niet zichtbaar uitgevoerd...')
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
  return modal;
}

async function closeTicketChannel(channel, reasonText) {
  try {
    await channel.send(`🔒 Ticket wordt gesloten... (${reasonText})`);
  } catch (_) {}

  setTimeout(async () => {
    try {
      await channel.delete(`Ticket gesloten: ${reasonText}`);
    } catch (err) {
      console.error('Kon ticket kanaal niet verwijderen:', err);
    }
  }, 10_000);
}

async function maakTicketKanaal({ guild, user, spelNummer, taakNummer }) {
  if (!TICKETS_CATEGORY_ID) throw new Error('TICKETS_CATEGORY_ID ontbreekt in .env');

  const safeUser = user.username.toLowerCase().replace(/[^a-z0-9\-]/g, '').slice(0, 12) || 'user';
  const channelName = `ticket-spel${spelNummer}-taak${taakNummer}-${safeUser}`;

  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    {
      id: user.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.AttachFiles,
        PermissionsBitField.Flags.EmbedLinks,
      ],
    },
    {
      id: guild.members.me.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.ManageChannels,
        PermissionsBitField.Flags.AttachFiles,
        PermissionsBitField.Flags.EmbedLinks,
      ],
    },
  ];

  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: TICKETS_CATEGORY_ID,
    permissionOverwrites: overwrites,
    topic: `Rad van StreApp | Spel ${spelNummer} | Taak ${taakNummer} | User ${user.id}`,
  });

  await channel.send({
    content:
      `🎟️ **Ticket aangemaakt**\n` +
      `**Spel:** ${spelNummer}\n` +
      `**Taak:** ${taakNummer}\n\n` +
      `👤 ${user} — stuur hier je **bewijs**:\n` +
      `✅ een **URL** óf\n` +
      `✅ een **screenshot / foto** (attachment)\n\n` +
      `ℹ️ Als admin kun je hieronder goedkeuren/afkeuren.`,
    components: [createAdminActieKnoppen()],
  });

  return channel;
}

/* ---------------- Dashboards ---------------- */

function closedBanner(game) {
  if (!game?.closed) return '';
  const d = game.closedAt ? new Date(game.closedAt) : new Date();
  return `🔒 **Spel afgesloten** — ${formatTimestamp(d)}\n\n`;
}

function buildDashboardText(game, spelNummer) {
  const taakSpots = game.taakSpots || {};
  const deelnemers = game.deelnemers || {};

  const taakDefLines = [];
  for (let t = 1; t <= 9; t++) taakDefLines.push(`Taak ${t}: **${taakSpots[String(t)] ?? 0}** Spots`);

  const rows = Object.entries(deelnemers)
    .map(([userId, info]) => {
      const totaal = info.totaalSpots ?? 0;
      const taken = info.taken ?? {};
      const totaalTaken = Object.values(taken).reduce((a, b) => a + (b || 0), 0);
      return { userId, totaal, totaalTaken };
    })
    .sort((a, b) => b.totaal - a.totaal);

  const scoreLines = rows.length
    ? rows.map((r, idx) => `${idx + 1}. <@${r.userId}> — **${r.totaal}** Spots | **${r.totaalTaken}** taken`)
    : ['(nog geen deelnemers/score)'];

  const taakCountLines = [];
  for (let t = 1; t <= 9; t++) taakCountLines.push(`Taak ${t}: **${game.taakCounts?.[String(t)] ?? 0}x**`);

  return (
    `📊 **Dashboard — Spel ${spelNummer}**\n\n` +
    closedBanner(game) +
    `⚙️ **Spots per taak**\n${taakDefLines.map(l => `• ${l}`).join('\n')}\n\n` +
    `🏁 **Totaalscore**\n${scoreLines.join('\n')}\n\n` +
    `📌 **Aantal uitgevoerde taken (totaal)**\n${taakCountLines.map(l => `• ${l}`).join('\n')}`
  );
}

function buildAdminDashboardText(game, spelNummer) {
  const deelnemers = game.deelnemers || {};
  const rows = Object.entries(deelnemers)
    .map(([userId, info]) => {
      const spots = info.totaalSpots ?? 0;
      const taken = info.taken ?? {};
      const counts = [];
      let totaalTaken = 0;
      for (let t = 1; t <= 9; t++) {
        const c = taken[String(t)] ?? 0;
        counts.push(c);
        totaalTaken += c;
      }
      return { userId, spots, totaalTaken, counts };
    })
    .sort((a, b) => b.spots - a.spots);

  if (!rows.length) {
    return `🔒 **Admin Dashboard — Spel ${spelNummer}**\n\n${closedBanner(game)}(nog geen deelnemers/goedkeuringen)`;
  }

  const header =
    `🔒 **Admin Dashboard — Spel ${spelNummer}**\n\n` +
    closedBanner(game) +
    `**Legenda:** Spots | T1..T9 = #goedkeuringen per taak | Totaal = #goedkeurde taken\n\n`;

  const lines = rows.slice(0, 150).map((r, idx) => {
    const t = r.counts.map((n, i) => `T${i + 1}:${n}`).join('  ');
    return `${idx + 1}. <@${r.userId}>  —  **${r.spots}** Spots  |  ${t}  |  **Totaal:${r.totaalTaken}**`;
  });

  return header + lines.join('\n');
}

async function ensureDashboardMessage(interaction, spelNummer) {
  const data = loadData();
  const game = getOrCreateGame(data, interaction.guildId, spelNummer);

  if (game.dashboard?.channelId && game.dashboard?.messageId) {
    const ch = await interaction.guild.channels.fetch(game.dashboard.channelId).catch(() => null);
    if (ch && ch.isTextBased()) {
      const msg = await ch.messages.fetch(game.dashboard.messageId).catch(() => null);
      if (msg) {
        await msg.edit(buildDashboardText(game, spelNummer)).catch(() => {});
        return;
      }
    }
  }

  const msg = await interaction.channel.send(buildDashboardText(game, spelNummer));
  game.dashboard = { channelId: interaction.channelId, messageId: msg.id };
  saveData(data);
}

async function updateDashboard(guild, guildId, spelNummer) {
  const data = loadData();
  const game = getOrCreateGame(data, guildId, spelNummer);

  const channelId = game.dashboard?.channelId;
  const messageId = game.dashboard?.messageId;
  if (!channelId || !messageId) return;

  const ch = await guild.channels.fetch(channelId).catch(() => null);
  if (!ch || !ch.isTextBased()) return;

  const msg = await ch.messages.fetch(messageId).catch(() => null);
  if (!msg) return;

  await msg.edit(buildDashboardText(game, spelNummer)).catch(() => {});
}

async function ensureAdminChannel(guild, guildId, spelNummer) {
  const data = loadData();
  const game = getOrCreateGame(data, guildId, spelNummer);

  if (game.adminChannelId) {
    const existing = await guild.channels.fetch(game.adminChannelId).catch(() => null);
    if (existing && existing.type === ChannelType.GuildText) return existing;
  }

  if (!ADMIN_CATEGORY_ID) throw new Error('ADMIN_CATEGORY_ID ontbreekt in .env');

  const cat = await guild.channels.fetch(ADMIN_CATEGORY_ID).catch(() => null);
  if (!cat || cat.type !== ChannelType.GuildCategory) throw new Error('ADMIN_CATEGORY_ID is ongeldig of geen categorie.');

  const name = `🎛️spel-${spelNummer}-admin`;

  const found = guild.channels.cache.find((c) => c.type === ChannelType.GuildText && c.name === name);
  if (found) {
    game.adminChannelId = found.id;
    saveData(data);
    return found;
  }

  const ch = await guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: ADMIN_CATEGORY_ID,
    reason: `Admin kanaal voor Spel ${spelNummer}`,
  });

  game.adminChannelId = ch.id;
  saveData(data);

  return ch;
}

async function ensureAdminDashboard(guild, guildId, spelNummer) {
  const data = loadData();
  const game = getOrCreateGame(data, guildId, spelNummer);

  const adminCh = await ensureAdminChannel(guild, guildId, spelNummer);

  if (game.adminDashboard?.channelId && game.adminDashboard?.messageId) {
    const ch = await guild.channels.fetch(game.adminDashboard.channelId).catch(() => null);
    if (ch && ch.isTextBased()) {
      const msg = await ch.messages.fetch(game.adminDashboard.messageId).catch(() => null);
      if (msg) {
        await msg.edit(buildAdminDashboardText(game, spelNummer)).catch(() => {});
        return;
      }
    }
  }

  const msg = await adminCh.send(buildAdminDashboardText(game, spelNummer));
  game.adminDashboard = { channelId: adminCh.id, messageId: msg.id };
  saveData(data);
}

async function updateAdminDashboard(guild, guildId, spelNummer) {
  const data = loadData();
  const game = getOrCreateGame(data, guildId, spelNummer);

  const channelId = game.adminDashboard?.channelId;
  const messageId = game.adminDashboard?.messageId;
  if (!channelId || !messageId) return;

  const ch = await guild.channels.fetch(channelId).catch(() => null);
  if (!ch || !ch.isTextBased()) return;

  const msg = await ch.messages.fetch(messageId).catch(() => null);
  if (!msg) return;

  await msg.edit(buildAdminDashboardText(game, spelNummer)).catch(() => {});
}

/* ---------------- UI messages ---------------- */

async function ensureTasksMessage(interaction, spelNummer) {
  const data = loadData();
  const game = getOrCreateGame(data, interaction.guildId, spelNummer);

  const channelId = game.ui?.tasksChannelId;
  const messageId = game.ui?.tasksMessageId;

  const tasksContent =
    `📋 **Taken voor Spel ${spelNummer}**\n\n` +
    `🎫 **Aanmelden**\n` +
    `• Na het aanmelden ontvang je de rol **Spel ${spelNummer}**.\n\n` +
    `✅ **Taak voltooid?**\n` +
    `• Kies hieronder de taak die je hebt afgerond.\n` +
    `• Drop je bewijs (URL of screenshot) in het ticket dat opent.\n\n` +
    `🎁 Zodra wij je inzending hebben goedgekeurd ontvang je automatisch je **Spots**.`;

  const disabled = !!game.closed;

  if (channelId && messageId) {
    const ch = await interaction.guild.channels.fetch(channelId).catch(() => null);
    if (ch && ch.isTextBased()) {
      const msg = await ch.messages.fetch(messageId).catch(() => null);
      if (msg) {
        await msg.edit({ content: tasksContent, components: createTaakKnoppen(disabled) }).catch(() => {});
        return;
      }
    }
  }

  const msg = await interaction.channel.send({ content: tasksContent, components: createTaakKnoppen(disabled) });
  game.ui = { tasksChannelId: interaction.channelId, tasksMessageId: msg.id };
  saveData(data);
}

function sanitizeStatus(status) {
  if (!status) return 'actief';
  return status.toLowerCase().replace(/[^a-z0-9\-]/g, '').slice(0, 20) || 'actief';
}

async function ensureRoleExists(guild, roleName) {
  let role = guild.roles.cache.find((r) => r.name === roleName);
  if (role) return role;
  return guild.roles.create({ name: roleName, reason: 'Nieuw Rad van StreApp spel' });
}

async function ensureChannelExistsUnderCategory(guild, channelName, categoryId) {
  let ch = guild.channels.cache.find((c) => c.type === ChannelType.GuildText && c.name === channelName);
  if (ch) return ch;

  if (categoryId) {
    const cat = await guild.channels.fetch(categoryId).catch(() => null);
    if (!cat || cat.type !== ChannelType.GuildCategory) throw new Error('SPEL_CATEGORY_ID is ongeldig of geen categorie.');
  }

  return guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: categoryId || null,
    reason: 'Nieuw Rad van StreApp spel',
  });
}

/* -------- Enable/disable aanmelden + tasks -------- */

async function setTasksButtonsForGame(guild, guildId, spelNummer, disabled) {
  const data = loadData();
  const game = getOrCreateGame(data, guildId, spelNummer);
  const chId = game.ui?.tasksChannelId;
  const msgId = game.ui?.tasksMessageId;
  if (!chId || !msgId) return false;

  const ch = await guild.channels.fetch(chId).catch(() => null);
  if (!ch || !ch.isTextBased()) return false;

  const msg = await ch.messages.fetch(msgId).catch(() => null);
  if (!msg) return false;

  await msg.edit({ components: createTaakKnoppen(disabled) }).catch(() => {});
  return true;
}

async function setAanmeldenButtonInChannel(channel, disabled) {
  const msgs = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (!msgs) return false;

  const botId = channel.client.user.id;

  const target = msgs.find((m) => {
    if (!m.author || m.author.id !== botId) return false;
    const comps = m.components || [];
    return comps.some((row) => row.components?.some((c) => c.customId === 'aanmelden_spel'));
  });

  if (!target) return false;

  const newComponents = target.components.map((row) => {
    const newRow = new ActionRowBuilder();
    row.components.forEach((c) => {
      if (c.customId === 'aanmelden_spel') {
        newRow.addComponents(
          new ButtonBuilder()
            .setCustomId('aanmelden_spel')
            .setLabel(c.label ?? 'Aanmelden')
            .setStyle(ButtonStyle.Success)
            .setDisabled(disabled)
        );
      } else {
        newRow.addComponents(ButtonBuilder.from(c));
      }
    });
    return newRow;
  });

  await target.edit({ components: newComponents }).catch(() => {});
  return true;
}

/* ---------------- NEW: reset + manual award helpers ---------------- */

function ensureDeelnemer(game, userId) {
  if (!game.deelnemers[userId]) {
    game.deelnemers[userId] = {
      totaalSpots: 0,
      taken: { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0, "6": 0, "7": 0, "8": 0, "9": 0 },
    };
  } else {
    if (typeof game.deelnemers[userId].totaalSpots !== 'number') game.deelnemers[userId].totaalSpots = 0;
    if (!game.deelnemers[userId].taken) {
      game.deelnemers[userId].taken = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0, "6": 0, "7": 0, "8": 0, "9": 0 };
    }
    for (let t = 1; t <= 9; t++) {
      const k = String(t);
      if (typeof game.deelnemers[userId].taken[k] !== 'number') game.deelnemers[userId].taken[k] = 0;
    }
  }
}

function resetGameProgress(game) {
  game.deelnemers = {};
  game.taakCounts = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0, "6": 0, "7": 0, "8": 0, "9": 0 };
}

/* ---------------- NEW: ensure ephemeral defer helper ---------------- */

async function ensureEphemeralDefer(interaction) {
  try {
    if (interaction.deferred || interaction.replied) return true;
    await interaction.deferReply({ ephemeral: true });
    return true;
  } catch {
    return false;
  }
}

/* ---------------- NEW: opschoon helpers ---------------- */

function deelnemerIsLeeg(info) {
  const spots = typeof info?.totaalSpots === 'number' ? info.totaalSpots : 0;
  const taken = info?.taken || {};
  let totaalTaken = 0;
  for (let t = 1; t <= 9; t++) {
    totaalTaken += (taken[String(t)] ?? 0);
  }
  return spots === 0 && totaalTaken === 0;
}

function sanitizeDeelnemerStructuur(game) {
  const deelnemers = game.deelnemers || {};
  for (const [userId, info] of Object.entries(deelnemers)) {
    ensureDeelnemer(game, userId);
    // ensureDeelnemer fixt structuur; scores blijven zoals ze zijn (behalve als corrupt -> default 0)
    // We nemen bestaande waarden over waar mogelijk:
    if (typeof info?.totaalSpots === 'number') game.deelnemers[userId].totaalSpots = info.totaalSpots;
    if (info?.taken && typeof info.taken === 'object') {
      for (let t = 1; t <= 9; t++) {
        const k = String(t);
        if (typeof info.taken[k] === 'number') game.deelnemers[userId].taken[k] = info.taken[k];
      }
    }
  }
}

async function forceRefreshAdminDashboard(guild, guildId, spelNummer) {
  const data = loadData();
  const game = getOrCreateGame(data, guildId, spelNummer);

  const adminCh = await ensureAdminChannel(guild, guildId, spelNummer);

  const msg = await adminCh.send(buildAdminDashboardText(game, spelNummer)).catch(() => null);
  if (!msg) return false;

  game.adminDashboard = { channelId: adminCh.id, messageId: msg.id };
  saveData(data);
  return true;
}

/* ---------------- Main interaction handler ---------------- */

client.on('interactionCreate', async (interaction) => {
  // Slash commands
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'nieuwspel') {
      if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
        return interaction.reply({ content: '❌ Alleen admins (Manage Server) mogen een nieuw spel starten.', ephemeral: true });
      }

      const spel = interaction.options.getInteger('spel', true);
      const status = sanitizeStatus(interaction.options.getString('status', false));

      const roleName = `Spel ${spel}`;
      const channelName = `🎡spel-${spel}-${status}`;

      try {
        const role = await ensureRoleExists(interaction.guild, roleName);
        const ch = await ensureChannelExistsUnderCategory(interaction.guild, channelName, SPEL_CATEGORY_ID);

        const data = loadData();
        getOrCreateGame(data, interaction.guildId, String(spel));
        saveData(data);

        await ch.send(`🎡 **Nieuw spel aangemaakt: Spel ${spel}**\n➡️ Run hier **/setupspel**.`);
        return interaction.reply({ content: `✅ Nieuw spel klaar:\n• Rol: **${role.name}**\n• Kanaal: ${ch}`, ephemeral: true });
      } catch (err) {
        console.error(err);
        return interaction.reply({
          content: '❌ Mislukt. Check rechten: **Manage Roles** + **Manage Channels** en `SPEL_CATEGORY_ID`.',
          ephemeral: true,
        });
      }
    }

    if (interaction.commandName === 'setupspel') {
      const spelNummer = getSpelNummerUitKanaalnaam(interaction.channel?.name ?? '');
      if (!spelNummer) return interaction.reply({ content: '❌ Geen `spel-<nummer>` in kanaalnaam.', ephemeral: true });

      const data = loadData();
      const game = getOrCreateGame(data, interaction.guildId, spelNummer);
      if (game.closed) {
        return interaction.reply({ content: `🔒 Spel ${spelNummer} is afgesloten. Setup wordt niet opnieuw geplaatst.`, ephemeral: true });
      }

      await ensureDashboardMessage(interaction, spelNummer);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('aanmelden_spel').setLabel('Aanmelden').setStyle(ButtonStyle.Success)
      );

      await interaction.channel.send({
        content: '🎡 **Rad van StreApp**\nKlik op **Aanmelden** om mee te doen aan dit spel.',
        components: [row],
      });

      await ensureTasksMessage(interaction, spelNummer);

      return interaction.reply({ content: '✅ Setup klaar: dashboard + aanmelden + taken geplaatst.', ephemeral: true });
    }

    if (interaction.commandName === 'setspots') {
      if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
        return interaction.reply({ content: '❌ Alleen admins mogen Spots instellen.', ephemeral: true });
      }

      const spelNummer = getSpelNummerUitKanaalnaam(interaction.channel?.name ?? '');
      if (!spelNummer) return interaction.reply({ content: '❌ Geen `spel-<nummer>` in kanaalnaam.', ephemeral: true });

      const data = loadData();
      const game = getOrCreateGame(data, interaction.guildId, spelNummer);
      if (game.closed) return interaction.reply({ content: `🔒 Spel ${spelNummer} is afgesloten. Spots aanpassen kan niet meer.`, ephemeral: true });

      const taak = interaction.options.getInteger('taak', true);
      const spots = interaction.options.getInteger('spots', true);

      game.taakSpots[String(taak)] = spots;
      saveData(data);

      await updateDashboard(interaction.guild, interaction.guildId, spelNummer);
      await updateAdminDashboard(interaction.guild, interaction.guildId, spelNummer);

      return interaction.reply({ content: `✅ Spel ${spelNummer}: Taak ${taak} = ${spots} Spots.`, ephemeral: true });
    }

    if (interaction.commandName === 'setupadmin') {
      if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
        return interaction.reply({ content: '❌ Alleen admins (Manage Server) mogen dit.', ephemeral: true });
      }

      const spel = interaction.options.getInteger('spel', true);
      const spelNummer = String(spel);

      try {
        const data = loadData();
        getOrCreateGame(data, interaction.guildId, spelNummer);
        saveData(data);

        await ensureAdminDashboard(interaction.guild, interaction.guildId, spelNummer);

        const data2 = loadData();
        const game2 = getOrCreateGame(data2, interaction.guildId, spelNummer);
        const adminChId = game2.adminChannelId;

        return interaction.reply({
          content: `✅ Admin dashboard geplaatst voor Spel ${spelNummer} in <#${adminChId}>`,
          ephemeral: true,
        });
      } catch (err) {
        console.error(err);
        return interaction.reply({
          content: '❌ Kon admin kanaal/dashboard niet maken. Check `ADMIN_CATEGORY_ID` + bot rechten (Manage Channels).',
          ephemeral: true,
        });
      }
    }

    if (interaction.commandName === 'sluitspel') {
      if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
        return interaction.reply({ content: '❌ Alleen admins (Manage Server) mogen dit.', ephemeral: true });
      }

      const spel = interaction.options.getInteger('spel', true);
      const spelNummer = String(spel);

      const data = loadData();
      const game = getOrCreateGame(data, interaction.guildId, spelNummer);

      if (game.closed) return interaction.reply({ content: `🔒 Spel ${spelNummer} is al afgesloten.`, ephemeral: true });

      game.closed = true;
      game.closedAt = new Date().toISOString();
      saveData(data);

      let tasksLocked = await setTasksButtonsForGame(interaction.guild, interaction.guildId, spelNummer, true).catch(() => false);

      let aanmeldenLocked = false;
      try {
        const spelChannel = interaction.guild.channels.cache.find(
          (c) => c.type === ChannelType.GuildText && (c.name || '').includes(`spel-${spelNummer}`)
        );
        if (spelChannel && spelChannel.isTextBased()) {
          aanmeldenLocked = await setAanmeldenButtonInChannel(spelChannel, true);
        }
      } catch (_) {}

      await updateDashboard(interaction.guild, interaction.guildId, spelNummer);
      await updateAdminDashboard(interaction.guild, interaction.guildId, spelNummer);

      await logToChannel(
        interaction.guild,
        `🔒 **Spel afgesloten**\n🎡 Spel: **${spelNummer}**\n🛠️ Admin: ${interaction.user} (\`${interaction.user.id}\`)\n🕒 ${formatTimestamp(new Date())}\n` +
          `✅ Taken locked: ${tasksLocked ? 'ja' : 'nee'} | ✅ Aanmelden locked: ${aanmeldenLocked ? 'ja' : 'nee'}`
      );

      return interaction.reply({
        content:
          `🔒 Spel **${spelNummer}** is afgesloten.\n` +
          `• Taken-knoppen: ${tasksLocked ? '✅ uitgeschakeld' : '⚠️ niet gevonden'}\n` +
          `• Aanmelden-knop: ${aanmeldenLocked ? '✅ uitgeschakeld' : '⚠️ niet gevonden'}\n` +
          `Dashboards zijn geüpdatet.`,
        ephemeral: true,
      });
    }

    if (interaction.commandName === 'openspel') {
      if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
        return interaction.reply({ content: '❌ Alleen admins (Manage Server) mogen dit.', ephemeral: true });
      }

      const spel = interaction.options.getInteger('spel', true);
      const spelNummer = String(spel);

      const data = loadData();
      const game = getOrCreateGame(data, interaction.guildId, spelNummer);

      if (!game.closed) return interaction.reply({ content: `✅ Spel ${spelNummer} is al actief (niet afgesloten).`, ephemeral: true });

      game.closed = false;
      game.closedAt = null;
      saveData(data);

      let tasksUnlocked = await setTasksButtonsForGame(interaction.guild, interaction.guildId, spelNummer, false).catch(() => false);

      let aanmeldenUnlocked = false;
      try {
        const spelChannel = interaction.guild.channels.cache.find(
          (c) => c.type === ChannelType.GuildText && (c.name || '').includes(`spel-${spelNummer}`)
        );
        if (spelChannel && spelChannel.isTextBased()) {
          aanmeldenUnlocked = await setAanmeldenButtonInChannel(spelChannel, false);
        }
      } catch (_) {}

      await updateDashboard(interaction.guild, interaction.guildId, spelNummer);
      await updateAdminDashboard(interaction.guild, interaction.guildId, spelNummer);

      await logToChannel(
        interaction.guild,
        `🔓 **Spel heropend**\n🎡 Spel: **${spelNummer}**\n🛠️ Admin: ${interaction.user} (\`${interaction.user.id}\`)\n🕒 ${formatTimestamp(new Date())}\n` +
          `✅ Taken unlocked: ${tasksUnlocked ? 'ja' : 'nee'} | ✅ Aanmelden unlocked: ${aanmeldenUnlocked ? 'ja' : 'nee'}`
      );

      return interaction.reply({
        content:
          `🔓 Spel **${spelNummer}** is weer actief.\n` +
          `• Taken-knoppen: ${tasksUnlocked ? '✅ ingeschakeld' : '⚠️ niet gevonden'}\n` +
          `• Aanmelden-knop: ${aanmeldenUnlocked ? '✅ ingeschakeld' : '⚠️ niet gevonden'}\n` +
          `Dashboards zijn geüpdatet.`,
        ephemeral: true,
      });
    }

    if (interaction.commandName === 'resetspel') {
      if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
        return interaction.reply({ content: '❌ Alleen admins (Manage Server) mogen dit.', ephemeral: true });
      }

      const spel = interaction.options.getInteger('spel', true);
      const bevestig = interaction.options.getBoolean('bevestig', true);
      const spelNummer = String(spel);

      if (!bevestig) {
        return interaction.reply({ content: '⚠️ Reset afgebroken. Zet `bevestig` op TRUE om echt te resetten.', ephemeral: true });
      }

      const data = loadData();
      const game = getOrCreateGame(data, interaction.guildId, spelNummer);

      resetGameProgress(game);
      saveData(data);

      await updateDashboard(interaction.guild, interaction.guildId, spelNummer);
      await updateAdminDashboard(interaction.guild, interaction.guildId, spelNummer);

      await logToChannel(
        interaction.guild,
        `🧨 **Spel gereset**\n🎡 Spel: **${spelNummer}**\n🛠️ Admin: ${interaction.user} (\`${interaction.user.id}\`)\n🕒 ${formatTimestamp(new Date())}\n` +
          `ℹ️ Scores/tellingen gewist (taak Spots bleven staan).`
      );

      return interaction.reply({ content: `🧨 Spel ${spelNummer} is gereset. Dashboards zijn bijgewerkt.`, ephemeral: true });
    }

    if (interaction.commandName === 'geeftaak') {
      if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
        return interaction.reply({ content: '❌ Alleen admins (Manage Server) mogen dit.', ephemeral: true });
      }

      const spel = interaction.options.getInteger('spel', true);
      const lid = interaction.options.getUser('lid', true);
      const taak = interaction.options.getInteger('taak', true);
      const aantal = interaction.options.getInteger('aantal', false) ?? 1;

      const spelNummer = String(spel);
      const taakKey = String(taak);

      const data = loadData();
      const game = getOrCreateGame(data, interaction.guildId, spelNummer);

      ensureDeelnemer(game, lid.id);

      const spotsPer = game.taakSpots?.[taakKey] ?? 0;

      // Negatief = afnemen (veilig: niet onder 0)
      if (aantal < 0) {
        const abs = Math.abs(aantal);

        const huidigTaken = game.deelnemers[lid.id].taken[taakKey] ?? 0;
        if (huidigTaken < abs) {
          return interaction.reply({ content: `❌ Kan niet afnemen: ${lid} heeft Taak ${taak} maar **${huidigTaken}x**.`, ephemeral: true });
        }

        const spotsAfnemen = spotsPer * abs;

        game.deelnemers[lid.id].taken[taakKey] = huidigTaken - abs;
        game.deelnemers[lid.id].totaalSpots = Math.max(0, (game.deelnemers[lid.id].totaalSpots ?? 0) - spotsAfnemen);

        game.taakCounts[taakKey] = Math.max(0, (game.taakCounts[taakKey] ?? 0) - abs);

        saveData(data);

        await updateDashboard(interaction.guild, interaction.guildId, spelNummer);
        await updateAdminDashboard(interaction.guild, interaction.guildId, spelNummer);

        await logToChannel(
          interaction.guild,
          `🛠️ **Handmatige afname**\n🎡 Spel: **${spelNummer}**\n👤 Lid: ${lid} (\`${lid.id}\`)\n` +
            `📌 Taak: **${taak}** | 🔁 Aantal: **-${abs}**\n` +
            `➖ Spots: **${spotsAfnemen}** (=${spotsPer} × ${abs})\n` +
            `🛠️ Admin: ${interaction.user} (\`${interaction.user.id}\`)\n🕒 ${formatTimestamp(new Date())}`
        );

        return interaction.reply({
          content:
            `✅ Afgenomen van ${lid}:\n• Spel ${spelNummer} — Taak ${taak} × ${-abs}\n• Spots eraf: ${spotsAfnemen} (=${spotsPer}×${abs})\nDashboards bijgewerkt.`,
          ephemeral: true,
        });
      }

      // Positief = toekennen
      const spotsTotaal = spotsPer * aantal;

      game.deelnemers[lid.id].taken[taakKey] = (game.deelnemers[lid.id].taken[taakKey] ?? 0) + aantal;
      game.deelnemers[lid.id].totaalSpots = (game.deelnemers[lid.id].totaalSpots ?? 0) + spotsTotaal;

      game.taakCounts[taakKey] = (game.taakCounts[taakKey] ?? 0) + aantal;

      saveData(data);

      await updateDashboard(interaction.guild, interaction.guildId, spelNummer);
      await updateAdminDashboard(interaction.guild, interaction.guildId, spelNummer);

      await logToChannel(
        interaction.guild,
        `🛠️ **Handmatige toekenning**\n🎡 Spel: **${spelNummer}**\n👤 Lid: ${lid} (\`${lid.id}\`)\n` +
          `📌 Taak: **${taak}** | 🔁 Aantal: **${aantal}**\n` +
          `➕ Spots: **${spotsTotaal}** (=${spotsPer} × ${aantal})\n` +
          `🛠️ Admin: ${interaction.user} (\`${interaction.user.id}\`)\n🕒 ${formatTimestamp(new Date())}`
      );

      return interaction.reply({
        content:
          `✅ Toegekend aan ${lid}:\n• Spel ${spelNummer} — Taak ${taak} × ${aantal}\n• Spots erbij: ${spotsTotaal} (=${spotsPer}×${aantal})\nDashboards bijgewerkt.`,
        ephemeral: true,
      });
    }

    // ✅ NIEUW: opschoonspel
    if (interaction.commandName === 'opschoonspel') {
      if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
        return interaction.reply({ content: '❌ Alleen admins (Manage Server) mogen dit.', ephemeral: true });
      }

      const spel = interaction.options.getInteger('spel', true);
      const spelNummer = String(spel);

      const data = loadData();
      const game = getOrCreateGame(data, interaction.guildId, spelNummer);

      // 1) structure repair (veilig)
      sanitizeDeelnemerStructuur(game);

      // 2) opschonen (alleen 0/0)
      const before = Object.keys(game.deelnemers || {}).length;
      for (const [userId, info] of Object.entries(game.deelnemers || {})) {
        if (deelnemerIsLeeg(info)) {
          delete game.deelnemers[userId];
        }
      }
      const after = Object.keys(game.deelnemers || {}).length;
      const removed = before - after;

      saveData(data);

      // 3) dashboards refresh
      await updateDashboard(interaction.guild, interaction.guildId, spelNummer);
      await updateAdminDashboard(interaction.guild, interaction.guildId, spelNummer);

      // 4) force refresh admin dashboard message (maakt nieuw bericht en tracked het)
      const forced = await forceRefreshAdminDashboard(interaction.guild, interaction.guildId, spelNummer).catch(() => false);

      await logToChannel(
        interaction.guild,
        `🧹 **Opschoonspel uitgevoerd**\n🎡 Spel: **${spelNummer}**\n🧽 Verwijderd (0/0): **${removed}**\n` +
          `🔁 Admin dashboard force refresh: ${forced ? 'ja' : 'nee'}\n🛠️ Admin: ${interaction.user} (\`${interaction.user.id}\`)\n🕒 ${formatTimestamp(new Date())}`
      );

      return interaction.reply({
        content: `🧹 Opschoonspel klaar voor Spel ${spelNummer}.\n• Verwijderd (0 spots/0 taken): ${removed}\n• Admin dashboard force refresh: ${forced ? '✅' : '⚠️'}`,
        ephemeral: true,
      });
    }

    return;
  }

  // Buttons
  if (interaction.isButton()) {
    // Afkeurknop: direct modal (geen defer)
    if (interaction.customId === 'ticket_afkeuren') {
      if (!hasAdminPermission(interaction)) {
        return interaction.reply({ content: '❌ Alleen admins kunnen dit.', ephemeral: true });
      }
      return interaction.showModal(buildAfkeurModal(interaction.channelId));
    }

    // alle andere buttons: defer (veilig)
    await ensureEphemeralDefer(interaction);

    if (interaction.customId === 'aanmelden_spel') {
      const spelNummer = getSpelNummerUitKanaalnaam(interaction.channel?.name ?? '');
      if (!spelNummer) return interaction.editReply('❌ Geen `spel-<nummer>` in kanaalnaam.');

      const data = loadData();
      const game = getOrCreateGame(data, interaction.guildId, spelNummer);
      if (game.closed) return interaction.editReply(`🔒 Spel ${spelNummer} is afgesloten. Aanmelden kan niet meer.`);

      const role = findSpelRole(interaction.guild, spelNummer);
      if (!role) return interaction.editReply(`❌ Ik kan geen rol vinden voor Spel ${spelNummer}.`);

      const member = interaction.member;

      if (member.roles.cache.has(role.id)) {
        return interaction.editReply(`ℹ️ Je bent al aangemeld (rol **${role.name}**).`);
      }

      try {
        await member.roles.add(role);
        return interaction.editReply(`✅ Aangemeld! Je hebt de rol **${role.name}** gekregen.\nJe kunt nu de **Taken** knoppen gebruiken.`);
      } catch (err) {
        console.error(err);
        return interaction.editReply('❌ Ik kan deze rol niet geven. Zet mijn botrol boven de Spel-rol en geef Manage Roles.');
      }
    }

    if (interaction.customId.startsWith('taak_confirm:')) {
      const parts = interaction.customId.split(':');
      const spelNummer = parts[1];
      const taakNummer = parts[2];

      try {
        const ticket = await maakTicketKanaal({ guild: interaction.guild, user: interaction.user, spelNummer, taakNummer });
        return interaction.editReply({ content: `✅ Ticket aangemaakt: ${ticket}`, components: [] });
      } catch (err) {
        console.error(err);
        return interaction.editReply({ content: '❌ Ticket kon niet worden aangemaakt. Check tickets-categorie + rechten.', components: [] });
      }
    }

    if (interaction.customId.startsWith('taak_cancel:')) {
      return interaction.editReply({ content: '❌ Geannuleerd. Er is geen ticket aangemaakt.', components: [] });
    }

    if (interaction.customId.startsWith('taak_')) {
      const taakNummer = interaction.customId.split('_')[1];
      const spelNummer = getSpelNummerUitKanaalnaam(interaction.channel?.name ?? '');
      if (!spelNummer) return interaction.editReply('❌ Geen `spel-<nummer>` in kanaalnaam.');

      const data = loadData();
      const game = getOrCreateGame(data, interaction.guildId, spelNummer);
      if (game.closed) return interaction.editReply(`🔒 Spel ${spelNummer} is afgesloten. Je kunt geen taken meer insturen.`);

      const role = findSpelRole(interaction.guild, spelNummer);
      if (!role) return interaction.editReply(`❌ Ik kan geen rol vinden voor Spel ${spelNummer}.`);

      const member = interaction.member;
      if (!member.roles.cache.has(role.id)) {
        return interaction.editReply(`❌ Je bent nog niet aangemeld voor Spel ${spelNummer}. Klik eerst op **Aanmelden**.`);
      }

      return interaction.editReply({
        content:
          `Gaaf! 🎉 Heb je **Taak ${taakNummer}** uitgevoerd?\n\n` +
          `✅ Klik dan op **Ticket openen** en drop je bewijs (URL of screenshot).\n` +
          `❌ Heb je de taak niet voltooid? Klik dan op **Annuleren**.\n\n` +
          `Zo voorkomen we onnodig werk voor onze admins.`,
        components: [createTaakConfirmKnoppen(spelNummer, taakNummer)],
      });
    }

    if (interaction.customId === 'ticket_goedkeuren') {
      await ensureEphemeralDefer(interaction);
      if (!hasAdminPermission(interaction)) return interaction.editReply('❌ Alleen admins kunnen dit.');

      const info = parseTicketTopic(interaction.channel?.topic);
      if (!info) return interaction.editReply('❌ Ticket-info ontbreekt (topic).');

      const targetUser = await client.users.fetch(info.userId).catch(() => null);
      if (!targetUser) return interaction.editReply('❌ Kan gebruiker niet vinden.');

      const data = loadData();
      const game = getOrCreateGame(data, interaction.guildId, info.spelNummer);
      const spotsVoorTaak = game.taakSpots?.[String(info.taakNummer)] ?? 0;

      ensureDeelnemer(game, info.userId);

      game.deelnemers[info.userId].totaalSpots += spotsVoorTaak;
      game.deelnemers[info.userId].taken[String(info.taakNummer)] =
        (game.deelnemers[info.userId].taken[String(info.taakNummer)] ?? 0) + 1;
      game.taakCounts[String(info.taakNummer)] = (game.taakCounts[String(info.taakNummer)] ?? 0) + 1;

      saveData(data);

      await updateDashboard(interaction.guild, interaction.guildId, info.spelNummer);
      await updateAdminDashboard(interaction.guild, interaction.guildId, info.spelNummer);

      const dmOk = await dmUserSafe(
        targetUser,
        `✅ Je bewijs is verwerkt voor **Spel ${info.spelNummer} – Taak ${info.taakNummer}**.\nJe hebt **${spotsVoorTaak} Spots** ontvangen. 🎡`
      );

      await interaction.channel.send(
        `✅ Ticket goedgekeurd door ${interaction.user}.\n➕ **${spotsVoorTaak} Spots** toegekend.\n` +
          `${dmOk ? '📩 DM verstuurd.' : '⚠️ Kon geen DM sturen.'}\n🔒 Ticket wordt gesloten.`
      ).catch(() => {});

      await logToChannel(
        interaction.guild,
        `✅ **Ticket goedgekeurd**\n👤 Deelnemer: <@${info.userId}> (\`${info.userId}\`)\n` +
          `🛠️ Admin: ${interaction.user} (\`${interaction.user.id}\`)\n🎡 Spel: **${info.spelNummer}** | 📌 Taak: **${info.taakNummer}**\n` +
          `➕ Spots: **${spotsVoorTaak}**\n🕒 Afgehandeld: ${formatTimestamp(new Date())}\n📍 Ticket: ${interaction.channel}`
      );

      await interaction.editReply('✅ Goedgekeurd + dashboard geüpdatet.');
      await closeTicketChannel(interaction.channel, 'goedgekeurd');
      return;
    }
  }

  // Modal submit (Afkeuren)
  if (interaction.isModalSubmit()) {
    if (!interaction.customId.startsWith('afkeur_reason:')) return;

    await ensureEphemeralDefer(interaction);

    if (!hasAdminPermission(interaction)) return interaction.editReply('❌ Alleen admins kunnen dit.');

    const info = parseTicketTopic(interaction.channel?.topic);
    if (!info) return interaction.editReply('❌ Ticket-info ontbreekt (topic).');

    const reason = interaction.fields.getTextInputValue('reason')?.trim() || 'Geen reden opgegeven.';
    const targetUser = await client.users.fetch(info.userId).catch(() => null);

    let dmOk = false;
    if (targetUser) {
      dmOk = await dmUserSafe(
        targetUser,
        `❌ Je bewijs is **afgekeurd** voor **Spel ${info.spelNummer} – Taak ${info.taakNummer}**.\n\n**Reden:** ${reason}`
      );
    }

    await interaction.channel.send(
      `❌ Ticket afgekeurd door ${interaction.user}.\n**Reden:** ${reason}\n` +
        `${dmOk ? '📩 DM verstuurd.' : '⚠️ Kon geen DM sturen.'}\n🔒 Ticket wordt gesloten.`
    ).catch(() => {});

    await logToChannel(
      interaction.guild,
      `❌ **Ticket afgekeurd**\n👤 Deelnemer: <@${info.userId}> (\`${info.userId}\`)\n` +
        `🛠️ Admin: ${interaction.user} (\`${interaction.user.id}\`)\n🎡 Spel: **${info.spelNummer}** | 📌 Taak: **${info.taakNummer}**\n` +
        `🕒 Afgehandeld: ${formatTimestamp(new Date())}\n📝 Reden: ${reason}\n📍 Ticket: ${interaction.channel}`
    );

    await updateAdminDashboard(interaction.guild, interaction.guildId, info.spelNummer);

    await interaction.editReply('✅ Afgekeurd + gelogd.');
    await closeTicketChannel(interaction.channel, 'afgekeurd');
  }
});

client.login(process.env.DISCORD_TOKEN);