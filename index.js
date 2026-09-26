require('dotenv').config();
const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');
const { initializeDatabase, saveCozy, markDiscordPosted, getCozyHistory, getCozyWinCount } = require('./database');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const TOP_COZY_CHANNEL_ID = process.env.TOP_COZY_CHANNEL_ID;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "98hasbdjmsnmcde";

// Initialize Discord Client with necessary intents
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Send Top Cozy via the active Discord client channel cache (bypasses Cloudflare REST rate limits)
async function sendDiscordWebhookMessage(username, cozyLevel, streamDate) {
    try {
        // If client is not ready or user isn't populated yet, wait briefly for the ready event
        if (!client.isReady() || !client.user) {
            console.log("⏳ Waiting for Discord client ready event...");
            await new Promise((resolve) => {
                if (client.isReady() && client.user) {
                    resolve();
                } else {
                    client.once('ready', resolve);
                }
            });
        }

        const date = new Date(streamDate + "T00:00:00");
        const formattedDate = date.toLocaleDateString("en-US", {
            month: "long",
            day: "numeric",
            year: "numeric"
        });

        console.log(`🔍 Fetching Discord channel ID: ${TOP_COZY_CHANNEL_ID}`);
        const channel = await client.channels.fetch(TOP_COZY_CHANNEL_ID);
        if (!channel) {
            throw new Error(`Could not find Discord channel with ID ${TOP_COZY_CHANNEL_ID}`);
        }

        await channel.send({
            embeds: [
                {
                    title: "🧸 TOP COZY!",
                    description:
                        `✨ **${username}** was today's Top Cozy!\n\n` +
                        `💜 Cozy Level: **${cozyLevel}%**\n` +
                        `📅 ${formattedDate}\n\n` +
                        `☕ Thank you for being cozy! 💜`,
                    color: 0xC084FC
                }
            ]
        });

        console.log("✅ Top Cozy message posted to Discord via bot client.");
        return true;
    } catch (error) {
        console.error("❌ Failed to post Discord message:", error);
        return false;
    }
}

// Webhook endpoint for stream automations
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

        if (row && row.discord_posted === 0) {
            console.log("📤 Attempting to post to Discord...");
            const posted = await sendDiscordWebhookMessage(username, parsedCozyLevel, streamDate);
            if (posted) {
                await markDiscordPosted(row.id);
            }
        } else {
            console.log("⏩ Skipping Discord post: Already marked as posted for today.");
        }

        res.json({ success: true, message: "Cozy win recorded successfully.", data: row });
    } catch (err) {
        console.error("❌ Error handling cozy webhook:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/', (req, res) => {
    res.send('🧸 Cozy Bot webhook server is running!');
});

// Discord message listener for !mycozy command
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.content.startsWith('!mycozy')) {
        try {
            const username = message.author.username;
            const winCount = await getCozyWinCount(username);
            const history = await getCozyHistory(username);

            let reply = `☕ **${username}'s Cozy Stats:**\nTotal Top Cozy Wins: **${winCount}**`;
            if (history && history.length > 0) {
                reply += `\n\nRecent History:\n` + history.map(h => `• ${h.stream_date}: ${h.cozy_level}%`).join('\n');
            } else {
                reply += `\n\nNo recorded wins yet. Get cozy on stream!`;
            }

            await message.reply(reply);
        } catch (err) {
            console.error("❌ Error handling !mycozy command:", err);
            await message.reply("Oops! Something went wrong fetching your cozy stats.");
        }
    }
});

client.once('ready', () => {
    console.log(`🚀 Logged in as ${client.user.tag}!`);
});

// Startup sequence
async function startBot() {
    console.log("🧸 Starting Cozy Bot...");
    console.log("🧸 Initializing database...");
    await initializeDatabase();
    console.log("✅ Database initialized.");

    app.listen(PORT, () => {
        console.log(`🧸 Cozy web server running on port ${PORT}`);
    });

    console.log("🚀 Connecting Cozy Bot to Discord client...");
    await client.login(DISCORD_TOKEN);
}

startBot().catch(err => {
    console.log("❌ Fatal error starting bot:", err);
});