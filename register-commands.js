require('dotenv').config();

const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('nieuwspel')
    .setDescription('Maak een nieuw spel aan (rol + kanaal).')
    .addIntegerOption(option =>
      option.setName('spel')
        .setDescription('Spelnummer, bijv 7')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('status')
        .setDescription('Bijv actief of afgerond')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('setupspel')
    .setDescription('Plaats dashboard + aanmelden + taken in dit spel-kanaal.'),

  new SlashCommandBuilder()
    .setName('setspots')
    .setDescription('Stel Spots per taak in voor dit spel.')
    .addIntegerOption(option =>
      option.setName('taak')
        .setDescription('Taaknummer 1 t/m 9')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(9)
    )
    .addIntegerOption(option =>
      option.setName('spots')
        .setDescription('Aantal Spots voor deze taak')
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(100000)
    ),

  new SlashCommandBuilder()
    .setName('setupadmin')
    .setDescription('Maak/plaats het Admin dashboard voor een spel (in een admin kanaal).')
    .addIntegerOption(option =>
      option.setName('spel')
        .setDescription('Spelnummer, bijv 7')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('sluitspel')
    .setDescription('Sluit een spel: taken uitzetten + dashboards locken.')
    .addIntegerOption(option =>
      option.setName('spel')
        .setDescription('Spelnummer, bijv 7')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('openspel')
    .setDescription('Heropen een spel: taken + aanmelden weer aan.')
    .addIntegerOption(option =>
      option.setName('spel')
        .setDescription('Spelnummer, bijv 7')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('resetspel')
    .setDescription('Reset alle scores/tellingen van een spel (taak spots blijven staan).')
    .addIntegerOption(option =>
      option.setName('spel')
        .setDescription('Spelnummer, bijv 7')
        .setRequired(true)
    )
    .addBooleanOption(option =>
      option.setName('bevestig')
        .setDescription('Zet op TRUE om echt te resetten')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('geeftaak')
    .setDescription('Ken een taak handmatig toe aan een lid (incl Spots + dashboards).')
    .addIntegerOption(option =>
      option.setName('spel')
        .setDescription('Spelnummer, bijv 7')
        .setRequired(true)
    )
    .addUserOption(option =>
      option.setName('lid')
        .setDescription('Het lid dat de taak toegekend krijgt')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName('taak')
        .setDescription('Taaknummer 1 t/m 9')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(9)
    )
    .addIntegerOption(option =>
      option.setName('aantal')
        .setDescription('Hoeveel keer (default 1) — gebruik negatief om af te nemen')
        .setRequired(false)
        .setMinValue(-1000)
        .setMaxValue(1000)
    ),

  // ✅ NIEUW: opschoonspel (veilig opschonen + admin dashboard refresh)
  new SlashCommandBuilder()
    .setName('opschoonspel')
    .setDescription('Opschonen van deelnemerslijst (verwijdert alleen 0-spots/0-taken) + force refresh dashboards.')
    .addIntegerOption(option =>
      option.setName('spel')
        .setDescription('Spelnummer, bijv 7')
        .setRequired(true)
    ),
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('🔄 Slash commands registreren...');

    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );

    console.log('✅ Klaar! Slash commands zijn geregistreerd.');
  } catch (error) {
    console.error('❌ Fout bij registreren:', error);
  }
})();