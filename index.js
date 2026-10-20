
require("dotenv").config();

const express = require("express");
const {
    Client,
    GatewayIntentBits,
    EmbedBuilder
} = require("discord.js");

const {
    initializeDatabase,
    saveCozy,
    markDiscordPosted,
    getCozyHistory,
    getCozyWinCount
} = require("./database");

const app = express();
app.use(express.json({ limit: "20kb" }));

const PORT = process.env.PORT || 10000;
const DISCORD_TOKEN = process.env.DISCORD_BOT_TOKEN;
const TOP_COZY_CHANNEL_ID = process.env.TOP_COZY_CHANNEL_ID;
const COZY_WEBHOOK_SECRET = process.env.COZY_WEBHOOK_SECRET;
const TIMEZONE = process.env.TIMEZONE || "America/New_York";

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

let databaseReady = false;
let discordReady = false;

client.once("ready", () => {
    discordReady = true;
    console.log(`🧸 Cozy Bot ONLINE as ${client.user.tag}`);
});

client.on("error", (error) => {
    console.error("❌ Discord error:", error.message);
});

client.on("shardDisconnect", () => {
    discordReady = false;
    console.log("⚠️ Discord disconnected.");
});

client.on("shardResume", () => {
    discordReady = true;
    console.log("🧸 Discord connection resumed.");
});

// ==================================================
// WEB SERVER
// ==================================================

app.get("/", (_req, res) => {
    res.status(200).send("🧸 Cozy Bot is alive!");
});

app.get("/health", (_req, res) => {
    const ready = databaseReady && discordReady;

    res.status(ready ? 200 : 503).json({
        success: ready,
        database: databaseReady ? "ready" : "not ready",
        discord: discordReady ? "ready" : "not ready"
    });
});

// ==================================================
// DATE HELPERS
// ==================================================

function getToday() {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: TIMEZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(new Date());

    const values = {};
    for (const part of parts) {
        values[part.type] = part.value;
    }

    return `${values.year}-${values.month}-${values.day}`;
}

function isValidDate(value) {
    if (typeof value !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return false;
    }

    const date = new Date(`${value}T00:00:00.000Z`);

    return !Number.isNaN(date.getTime()) &&
        date.toISOString().slice(0, 10) === value;
}

function formatDate(value) {
    const dateString = String(value).slice(0, 10);
    const date = new Date(`${dateString}T00:00:00.000Z`);

    return date.toLocaleDateString("en-US", {
        timeZone: "UTC",
        month: "long",
        day: "numeric",
        year: "numeric"
    });
}

// ==================================================
// SEND TOP COZY TO DISCORD
// ==================================================

async function postTopCozy(username, cozyLevel, streamDate) {
    if (!client.isReady()) {
        throw new Error("Discord bot is not ready.");
    }

    const channel = await client.channels.fetch(
        TOP_COZY_CHANNEL_ID
    );

    if (!channel || !channel.isTextBased() ||
        typeof channel.send !== "function") {
        throw new Error(
            "Top Cozy channel was not found or is not a text channel."
        );
    }

    const embed = new EmbedBuilder()
        .setTitle("🧸 TOP COZY!")
        .setDescription(
            `✨ **${username}** was today's Top Cozy!\n\n` +
            `💜 Cozy Level: **${cozyLevel}%**\n` +
            `📅 ${formatDate(streamDate)}\n\n` +
            "☕ Thank you for being cozy! 💜"
        )
        .setColor(0xC084FC);

    await channel.send({ embeds: [embed] });

    console.log(
        `✅ TOP COZY POSTED: ${username} - ${cozyLevel}% - ${streamDate}`
    );
}

// ==================================================
// MIX IT UP → RENDER
// Keep secret in the existing JSON request body.
// ==================================================

app.post("/cozy", async (req, res) => {
    try {
        console.log("🧸 COZY POST RECEIVED:", {
            username: req.body?.username,
            cozyLevel: req.body?.cozyLevel,
            streamDate: req.body?.streamDate
        });

        // Check secret exactly as the original Mix It Up request sends it.
        if (
            !COZY_WEBHOOK_SECRET ||
            typeof req.body?.secret !== "string" ||
            req.body.secret !== COZY_WEBHOOK_SECRET
        ) {
            console.log("❌ Invalid Cozy secret.");

            return res.status(401).json({
                success: false,
                message: "Invalid secret."
            });
        }

        const username = String(req.body?.username || "").trim();

        if (!username || username.length > 100) {
            return res.status(400).json({
                success: false,
                message: "A valid username is required."
            });
        }

        const rawLevel = req.body?.cozyLevel;
        const cozyLevel =
            typeof rawLevel === "number"
                ? rawLevel
                : typeof rawLevel === "string" &&
                    rawLevel.trim() !== ""
                    ? Number(rawLevel)
                    : NaN;

        if (
            !Number.isInteger(cozyLevel) ||
            cozyLevel < 0 ||
            cozyLevel > 100
        ) {
            console.log("❌ Invalid Cozy level.");

            return res.status(400).json({
                success: false,
                message: "Cozy level must be a whole number from 0 to 100."
            });
        }

        let streamDate = String(req.body?.streamDate || "").trim();

        if (!streamDate) {
            streamDate = getToday();
        } else if (!isValidDate(streamDate)) {
            return res.status(400).json({
                success: false,
                message: "Stream date must be a real YYYY-MM-DD date."
            });
        }

        if (!databaseReady || !discordReady) {
            return res.status(503).json({
                success: false,
                message: "Cozy Bot is not ready. Please retry."
            });
        }

        console.log(`📅 Using stream date: ${streamDate}`);

        // Save a new record or retrieve the existing record.
        // Existing history is preserved; no tables or records are deleted.
        const saveResult = await saveCozy(
            username,
            cozyLevel,
            streamDate
        );

        console.log("📊 Database result:", {
            saved: saveResult.saved,
            foundRecord: Boolean(saveResult.row)
        });

        const record = saveResult.row;

        if (!record) {
            return res.status(500).json({
                success: false,
                message: "Could not save or retrieve the Cozy record."
            });
        }

        // Do not post the same record again if Discord already confirmed it.
        if (record.discord_posted) {
            console.log("ℹ️ This Cozy result was already posted.");

            return res.status(200).json({
                success: true,
                duplicate: true,
                message: "This Cozy result was already posted."
            });
        }

        // IMPORTANT:
        // If a previous attempt saved the record but failed to post,
        // another request will retry posting this existing unposted record.
        await postTopCozy(
            record.username,
            record.cozy_level,
            record.stream_date
        );

        // Mark posted only after Discord accepts the message.
        await markDiscordPosted(record.id);

        console.log("✅ Cozy record marked as posted.");

        return res.status(200).json({
            success: true,
            duplicate: false,
            username: record.username,
            cozyLevel: record.cozy_level,
            streamDate: String(record.stream_date).slice(0, 10)
        });
    } catch (error) {
        console.error("❌ /cozy ERROR:", error.message);

        return res.status(500).json({
            success: false,
            message: "Cozy request failed. Check the Render logs."
        });
    }
});

// ==================================================
// !MYCOZY
// ==================================================

client.on("messageCreate", async (message) => {
    if (message.author.bot) return;

    if (message.content.trim().toLowerCase() !== "!mycozy") {
        return;
    }

    try {
        const username = message.author.username;

        const history = await getCozyHistory(username);
        const winCount = await getCozyWinCount(username);

        if (!history || history.length === 0) {
            return message.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle(`🧸 ${username}'s Cozy History`)
                        .setDescription(
                            "You don't have any Top Cozy wins yet! ☕💜"
                        )
                        .setColor(0xC084FC)
                ],
                allowedMentions: { repliedUser: false }
            });
        }

        const historyText = history
            .map((record) => {
                return (
                    `📅 ${formatDate(record.stream_date)} — ` +
                    `**${record.cozy_level}%**`
                );
            })
            .join("\n");

        // Discord embed descriptions have a 4096-character limit.
        const displayedHistory = historyText.length > 3500
            ? historyText.slice(0, 3500) + "\n…"
            : historyText;

        return message.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle(`🧸 ${username}'s Cozy History`)
                    .setDescription(
                        `🏆 **${winCount} Top Cozy win${winCount === 1 ? "" : "s"}**\n\n` +
                        `${displayedHistory}\n\n` +
                        "☕ Keep being cozy! 💜"
                    )
                    .setColor(0xC084FC)
            ],
            allowedMentions: { repliedUser: false }
        });
    } catch (error) {
        console.error("❌ !mycozy ERROR:", error.message);

        await message.reply(
            "🧸 I couldn't load your Cozy history right now. Please try again later."
        ).catch(() => {});
    }
});

// ==================================================
// START BOT
// ==================================================

async function start() {
    console.log("🧸 Starting Cozy Bot...");

    if (!DISCORD_TOKEN) {
        throw new Error("DISCORD_BOT_TOKEN is missing.");
    }

    if (!TOP_COZY_CHANNEL_ID) {
        throw new Error("TOP_COZY_CHANNEL_ID is missing.");
    }

    if (!COZY_WEBHOOK_SECRET) {
        throw new Error("COZY_WEBHOOK_SECRET is missing.");
    }

    if (!process.env.DATABASE_URL) {
        throw new Error("DATABASE_URL is missing.");
    }

    await initializeDatabase();
    databaseReady = true;

    app.listen(PORT, "0.0.0.0", () => {
        console.log(`🧸 Cozy web server running on port ${PORT}`);
    });

    console.log("🚀 Connecting Cozy Bot to Discord...");
    await client.login(DISCORD_TOKEN);
}

start().catch((error) => {
    console.error("❌ Failed to start Cozy Bot:", error.message);
    process.exit(1);
});
