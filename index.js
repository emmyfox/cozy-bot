require("dotenv").config();

const express = require("express");
const {
    Client,
    GatewayIntentBits
} = require("discord.js");
const https = require("https");

const {
    initializeDatabase,
    saveCozy,
    markDiscordPosted,
    getCozyHistory,
    getCozyWinCount
} = require("./database");

const app = express();

app.use(express.json());

const PORT = process.env.PORT || 10000;

// ==================================================
// RENDER ENVIRONMENT VARIABLES
// ==================================================

const DISCORD_TOKEN = process.env.DISCORD_BOT_TOKEN;
const TOP_COZY_CHANNEL_ID = process.env.TOP_COZY_CHANNEL_ID;
const COZY_WEBHOOK_SECRET = process.env.COZY_WEBHOOK_SECRET;

// ==================================================
// DISCORD CLIENT
// ==================================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Detailed client debugging
client.on("debug", (debug) => {
    console.log(`🔎 Discord debug: ${debug}`);
});

client.once("ready", () => {
    console.log(`🧸 Cozy Bot ONLINE as ${client.user.tag}`);
});

client.on("error", (error) => {
    console.error("❌ Discord error:", error);
});

// ==================================================
// WEB SERVER
// ==================================================

app.get("/", (req, res) => {
    res.send("🧸 Cozy Bot is alive!");
});

app.get("/cozy", (req, res) => {
    res.send("🧸 Cozy endpoint is active! Send a POST request from Mix It Up.");
});

// ==================================================
// SEND TOP COZY TO DISCORD (POLLING SAFE QUEUE)
// ==================================================

async function postTopCozySafe(username, cozyLevel, streamDate, recordId) {
    try {
        let retries = 30;
        while (!client.isReady() && retries > 0) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            retries--;
        }

        if (!client.isReady()) {
            throw new Error("Discord client is not ready after 30 seconds.");
        }

        const channel = await client.channels.fetch(
            TOP_COZY_CHANNEL_ID
        );

        if (!channel) {
            throw new Error("Top Cozy channel was not found.");
        }

        const date = new Date(
            `${streamDate}T00:00:00`
        );

        const formattedDate = date.toLocaleDateString(
            "en-US",
            {
                month: "long",
                day: "numeric",
                year: "numeric"
            }
        );

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

        await markDiscordPosted(recordId);

        console.log(
            `✅ TOP COZY POSTED: ${username} ${cozyLevel}% - ${streamDate}`
        );
    } catch (error) {
        console.error("❌ Background Discord post failed:", error);
    }
}

// ==================================================
// MIX IT UP → RENDER
// ==================================================

app.post("/cozy", async (req, res) => {

    try {

        console.log("🧸 COZY POST RECEIVED:", {
            username: req.body.username,
            cozyLevel: req.body.cozyLevel,
            streamDate: req.body.streamDate
        });

        if (
            !req.body.secret ||
            req.body.secret !== COZY_WEBHOOK_SECRET
        ) {
            console.log("❌ Invalid Cozy secret.");
            return res.status(401).json({
                success: false,
                message: "Invalid secret."
            });
        }

        const username =
            String(req.body.username || "").trim();

        if (!username) {
            return res.status(400).json({
                success: false,
                message: "Username is required."
            });
        }

        const cozyLevel =
            Number(req.body.cozyLevel);

        if (
            !Number.isInteger(cozyLevel) ||
            cozyLevel < 0 ||
            cozyLevel > 100
        ) {
            return res.status(400).json({
                success: false,
                message: "Cozy level must be between 0 and 100."
            });
        }

        let streamDate =
            String(req.body.streamDate || "").trim();

        if (
            !/^\d{4}-\d{2}-\d{2}$/.test(streamDate)
        ) {
            streamDate =
                new Intl.DateTimeFormat(
                    "en-CA",
                    {
                        timeZone: "America/New_York",
                        year: "numeric",
                        month: "2-digit",
                        day: "2-digit"
                    }
                ).format(new Date());
        }

        console.log(
            `📅 Using stream date: ${streamDate}`
        );

        const saveResult = await saveCozy(
            username,
            cozyLevel,
            streamDate
        );

        console.log(
            "📊 DB Result:",
            saveResult
        );

        if (!saveResult.row) {
            return res.status(500).json({
                success: false,
                message: "Could not save Cozy record."
            });
        }

        const recordId = saveResult.row.id;

        res.json({
            success: true,
            duplicate: saveResult.row.discord_posted,
            username,
            cozyLevel,
            streamDate
        });

        if (!saveResult.row.discord_posted) {
            postTopCozySafe(username, cozyLevel, streamDate, recordId);
        } else {
            console.log("ℹ️ This Cozy result was already posted.");
        }

    } catch (error) {
        console.error("❌ /cozy ERROR:", error);
        if (!res.headersSent) {
            return res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }
});

// ==================================================
// !MYCOZY
// ==================================================

client.on("messageCreate", async (message) => {
    try {
        if (message.author.bot) return;

        if (
            message.content.trim().toLowerCase() !==
            "!mycozy"
        ) {
            return;
        }

        const username = message.author.username;
        const history = await getCozyHistory(username);
        const winCount = await getCozyWinCount(username);

        if (!history || history.length === 0) {
            return message.reply({
                embeds: [
                    {
                        title: `🧸 ${username}'s Cozy History`,
                        description: "You don't have any Top Cozy wins yet! ☕💜",
                        color: 0xC084FC
                    }
                ]
            });
        }

        const historyText = history
            .map((record) => {
                const date = new Date(`${record.stream_date}T00:00:00`);
                const formattedDate = date.toLocaleDateString("en-US", {
                    month: "long",
                    day: "numeric",
                    year: "numeric"
                });
                return `📅 ${formattedDate} — **${record.cozy_level}%**`;
            })
            .join("\n");

        return message.reply({
            embeds: [
                {
                    title: `🧸 ${username}'s Cozy History`,
                    description:
                        `🏆 **${winCount} Top Cozy win${winCount === 1 ? "" : "s"}**\n\n` +
                        historyText +
                        `\n\n☕ Keep being cozy! 💜`,
                    color: 0xC084FC
                }
            ]
        });

    } catch (error) {
        console.error("❌ !mycozy ERROR:", error);
    }
});

// ==================================================
// START BOT
// ==================================================

async function start() {
    console.log("🧸 Starting Cozy Bot...");

    if (!DISCORD_TOKEN) throw new Error("DISCORD_BOT_TOKEN is missing.");
    if (!TOP_COZY_CHANNEL_ID) throw new Error("TOP_COZY_CHANNEL_ID is missing.");
    if (!COZY_WEBHOOK_SECRET) throw new Error("COZY_WEBHOOK_SECRET is missing.");

    await initializeDatabase();

    app.listen(PORT, "0.0.0.0", () => {
        console.log(`🧸 Cozy web server running on port ${PORT}`);
    });

    const RENDER_URL = process.env.RENDER_EXTERNAL_URL || "https://cozy-bot-e1zc.onrender.com/";
    setInterval(() => {
        https.get(RENDER_URL, (res) => {
            // Keep alive
        }).on("error", () => {});
    }, 10 * 60 * 1000);

    console.log("🚀 Connecting Cozy Bot to Discord...");
    try {
        await client.login(DISCORD_TOKEN);
        console.log("✅ Discord login method completed successfully.");
    } catch (error) {
        console.error("❌ Critical Discord Login Failure:", error);
    }
}

start().catch((error) => {
    console.error("❌ Failed to start Cozy Bot:", error);
});