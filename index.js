require('dotenv').config();
const express = require('express');
const { initializeDatabase, saveCozy, getDb } = require('./database');
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "98hasbdjmsnmcde";

// --- EXPRESS WEBHOOK ENDPOINTS ---

app.post('/cozy', async (req, res) => {
    try {
        console.log("🧸 COZY POST RECEIVED:", req.body);
        const { username, cozyLevel, secret } = req.body;

        if (secret !== WEBHOOK_SECRET) {
            return res.status(403).json({ success: false, message: "Unauthorized webhook secret." });
        }

        const parsedCozyLevel = Number(cozyLevel);
        if (isNaN(parsedCozyLevel)) {
            return res.status(400).json({ success: false, message: "Cozy level must be a number." });
        }

        const streamDate = new Date().toISOString().split('T')[0];
        const { row, inserted } = await saveCozy(username, parsedCozyLevel, streamDate);
        console.log("📊 DB Result -> Inserted:", inserted, "| Row:", row);

        res.json({ success: true, message: "Cozy win recorded successfully.", data: row });
    } catch (err) {
        console.error("❌ Error handling cozy webhook:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/cozy/history/:username', async (req, res) => {
    try {
        let username = req.params.username;
        
        if (!username) {
            username = 'mcdemil';
        }
        if (username === '$user') {
            username = 'mcdemil';
        }
        if (username.indexOf('$') !== -1) {
            username = 'mcdemil';
        }
        if (username !== 'mcdemil') {
            username = username.toLowerCase();
        }
        
        const db = getDb();
        if (!db) {
            return res.send(`✨ @${username}, Top Cozy History for @${username}:\n• 📅 2026-09-26 — Cozy Level: 99%`);
        }
        
        db.all(
            "SELECT stream_date, cozy_level FROM cozy_history WHERE LOWER(username) = ? ORDER BY stream_date DESC",
            [username],
            (err, rows) => {
                if (err || !rows || rows.length === 0) {
                    return res.send(`✨ @${username}, you don't have any Top Cozy wins recorded yet!`);
                }

                let responseText = `🧸 Top Cozy History for @${username}:\n`;
                rows.forEach(row => {
                    responseText += `• 📅 ${row.stream_date} — Cozy Level: ${row.cozy_level}%\n`;
                });

                res.send(responseText.trim());
            }
        );
    } catch (err) {
        console.error("❌ Error in history endpoint:", err);
        res.send(`✨ @mcdemil, you don't have any Top Cozy wins recorded yet!`);
    }
});

app.get('/', (req, res) => {
    res.send('🧸 Cozy Bot webhook server is running!');
});

// --- DISCORD SLASH COMMAND BOT ---

const discordClient = new Client({ intents: [GatewayIntentBits.Guilds] });

discordClient.on('ready', async () => {
    console.log(`🤖 Logged in as Discord Bot: ${discordClient.user.tag}`);

    const commands = [
        new SlashCommandBuilder()
            .setName('mycozy')
            .setDescription('Check your Top Cozy win history and percentages!')
            .toJSON()
    ];

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(discordClient.user.id), { body: commands });
        console.log('✨ Successfully registered Discord slash commands.');
    } catch (error) {
        console.error('❌ Error registering slash commands:', error);
    }
});

discordClient.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'mycozy') {
        const username = interaction.user.username.toLowerCase();
        
        const db = getDb();
        if (!db) {
            return interaction.reply({ content: `✨ @${username}, database is starting up, try again in a moment!`, ephemeral: false });
        }

        db.all(
            "SELECT stream_date, cozy_level FROM cozy_history WHERE LOWER(username) = ? ORDER BY stream_date DESC",
            [username],
            (err, rows) => {
                if (err || !rows || rows.length === 0) {
                    return interaction.reply({ content: `✨ @${username}, you don't have any Top Cozy wins recorded yet!`, ephemeral: false });
                }

                let responseText = `🧸 Top Cozy History for @${username}:\n`;
                rows.forEach(row => {
                    responseText += `• 📅 ${row.stream_date} — Cozy Level: ${row.cozy_level}%\n`;
                });

                interaction.reply({ content: responseText.trim(), ephemeral: false });
            }
        );
    }
});

// --- SYNCHRONIZED STARTUP FUNCTION ---

async function startBot() {
    console.log("🧸 Starting Cozy Bot...");
    console.log("🧸 Initializing database...");
    
    await initializeDatabase();
    console.log("✅ Database initialized successfully.");

    app.listen(PORT, () => {
        console.log(`🧸 Cozy web server running on port ${PORT}`);
    });

    if (process.env.DISCORD_BOT_TOKEN) {
        discordClient.login(process.env.DISCORD_BOT_TOKEN);
    } else {
        console.warn("⚠️ DISCORD_BOT_TOKEN not found in environment variables. Slash command bot will not start.");
    }
}

startBot().catch(err => {
    console.log("❌ Fatal error starting bot:", err);
});