require("dotenv").config();

const express = require("express");
const {
    Client,
    GatewayIntentBits
} = require("discord.js");

const {
    initializeDatabase,
    saveCozy,
    markDiscordPosted,
    getCozyHistory,
    getCozyWinCount
} = require("./database");

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const TOP_COZY_CHANNEL_ID = process.env.TOP_COZY_CHANNEL_ID;
const COZY_WEBHOOK_SECRET = process.env.COZY_WEBHOOK_SECRET;

const PORT = process.env.PORT || 10000;

// Discord Client with websocket compression disabled for Render
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
    ws: {
        compress: false
    }
});

client.once("ready", () => {
    console.log(`🧸 Cozy Bot ONLINE as ${client.user.tag}`);
});

client.on("error", (error) => {
    console.error("❌ DISCORD CLIENT ERROR:", error);
});

// Express Web Server
const app = express();
app.use(express.json());

app.get("/", (req, res) => {
    res.send("🧸 Cozy Bot is alive!");
});

// Helper to send Top Cozy via Discord REST API
async function sendDiscordWebhookMessage(username, cozyLevel, streamDate) {
    try {
        const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
        
        const date = new Date(streamDate + "T00:00:00");
        const formattedDate = date.toLocaleDateString("en-US", {
            month: "long",
            day: "numeric",
            year: "numeric"
        });

        const url = `https://discord.com/api/v10/channels/${TOP_COZY_CHANNEL_ID}/messages`;
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bot ${DISCORD_TOKEN.trim()}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
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
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Discord API error: ${response.status} - ${errText}`);
        }

        console.log("✅ Top Cozy message posted to Discord via REST API.");
        return true;
    } catch (error) {
        console.error("❌ Failed to post Discord message:", error);
        return false;
    }
}

// Webhook endpoint for stream
app.post("/cozy", async (req, res) => {
    try {
        console.log("🧸 COZY POST RECEIVED:", { username: req.body.username, cozyLevel: req.body.cozyLevel });

        if (!req.body.secret || req.body.secret !== COZY_WEBHOOK_SECRET) {
            return res.status(401).json({ success: false, message: "Invalid secret." });
        }

        const username = String(req.body.username || "").trim();
        if (!username) {
            return res.status(400).json({ success: false, message: "Username is required." });
        }

        const cozyLevel = Number(req.body.cozyLevel);
        if (!Number.isInteger(cozyLevel) || cozyLevel < 0 || cozyLevel > 100) {
            return res.status(400).json({ success: false, message: "Cozy level must be 0 to 100." });
        }

        const streamDate = new Date().toISOString().slice(0, 10);
        const saveResult = await saveCozy(username, cozyLevel, streamDate);

        if (!saveResult.row) {
            return res.status(500).json({ success: false, message: "Could not save Cozy record." });
        }

        const recordId = saveResult.row.id;

        if (saveResult.row.discord_posted) {
            return res.json({ success: true, duplicate: true, message: "Already posted." });
        }

        const posted = await sendDiscordWebhookMessage(username, cozyLevel, streamDate);
        if (!posted) {
            return res.status(500).json({ success: false, message: "Discord posting failed." });
        }

        await markDiscordPosted(recordId);
        return res.json({ success: true, duplicate: false, message: "Top Cozy saved and posted to Discord!" });
    } catch (error) {
        console.error("❌ /cozy ERROR:", error);
        return res.status(500).json({ success: false, message: "Internal server error." });
    }
});

// Discord Message Listener for !mycozy
client.on("messageCreate", async (message) => {
    try {
        if (message.author.bot) return;
        if (message.content.trim().toLowerCase() !== "!mycozy") return;

        const username = message.author.username;
        console.log(`🧸 !mycozy requested by ${username}`);

        const history = await getCozyHistory(username);
        const winCount = await getCozyWinCount(username);

        if (!history || history.length === 0) {
            return message.reply({
                embeds: [{
                    title: `🧸 ${username}'s Cozy History`,
                    description: "You don't have any Top Cozy wins yet! ☕💜",
                    color: 0xC084FC
                }]
            });
        }

        const historyText = history.map((record) => {
            const date = new Date(record.stream_date + "T00:00:00");
            const formattedDate = date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
            return `📅 ${formattedDate} — **${record.cozy_level}%**`;
        }).join("\n");

        return message.reply({
            embeds: [{
                title: `🧸 ${username}'s Cozy History`,
                description: `🏆 **${winCount} Top Cozy win${winCount === 1 ? "" : "s"}**\n\n` + historyText + `\n\n☕ Keep being cozy! 💜`,
                color: 0xC084FC
            }]
        });
    } catch (error) {
        console.error("❌ !mycozy ERROR:", error);
    }
});

async function start() {
    console.log("🧸 Starting Cozy Bot...");
    if (!DISCORD_TOKEN) throw new Error("DISCORD_TOKEN is missing.");
    if (!TOP_COZY_CHANNEL_ID) throw new Error("TOP_COZY_CHANNEL_ID is missing.");
    if (!COZY_WEBHOOK_SECRET) throw new Error("COZY_WEBHOOK_SECRET is missing.");

    console.log("🧸 Initializing database...");
    await initializeDatabase();
    console.log("✅ Database initialized.");

    app.listen(PORT, "0.0.0.0", () => {
        console.log("🧸 Cozy web server running on port " + PORT);
    });

    console.log("🚀 Connecting Cozy Bot to Discord client...");
    client.login(DISCORD_TOKEN.trim());
}

start();