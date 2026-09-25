```js
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
app.use(express.json());

const PORT = process.env.PORT || 10000;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const TOP_COZY_CHANNEL_ID = process.env.TOP_COZY_CHANNEL_ID;
const COZY_WEBHOOK_SECRET = process.env.COZY_WEBHOOK_SECRET;
const TIMEZONE = process.env.TIMEZONE || "America/New_York";

function cleanUsername(username) {
    return String(username || "")
        .replace(/^@/, "")
        .trim();
}

function validCozyLevel(level) {
    const number = Number(level);

    if (!Number.isFinite(number)) {
        return null;
    }

    if (number < 0 || number > 100) {
        return null;
    }

    return Math.round(number);
}

function getToday() {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: TIMEZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).format(new Date());
}

function getDisplayDate() {
    return new Intl.DateTimeFormat("en-US", {
        timeZone: TIMEZONE,
        year: "numeric",
        month: "long",
        day: "numeric"
    }).format(new Date());
}

// --------------------------------------------------
// HEALTH CHECK
// --------------------------------------------------

app.get("/", (req, res) => {
    res.send("🧸 Cozy Bot is awake!");
});

// --------------------------------------------------
// COZY WEBHOOK
// --------------------------------------------------

app.post("/cozy", async (req, res) => {
    console.log("🧸 COZY POST RECEIVED:", {
        username: req.body.username,
        cozyLevel: req.body.cozyLevel,
        secret: "[hidden]"
    });

    try {
        const { username, cozyLevel, secret } = req.body;

        const receivedSecret = String(secret || "")
            .replace(/\r/g, "")
            .replace(/\n/g, "")
            .trim();

        const savedSecret = String(COZY_WEBHOOK_SECRET || "")
            .replace(/\r/g, "")
            .replace(/\n/g, "")
            .trim();

        console.log("🔐 Received secret length:", receivedSecret.length);
        console.log("🔐 Render secret length:", savedSecret.length);
        console.log(
            "🔐 Secret lengths match:",
            receivedSecret.length === savedSecret.length
        );

        if (!savedSecret) {
            console.log("❌ COZY_WEBHOOK_SECRET is empty in Render.");

            return res.status(500).json({
                success: false,
                error: "Server secret is not configured"
            });
        }

        if (receivedSecret !== savedSecret) {
            console.log("❌ Cozy secret rejected.");

            return res.status(401).json({
                success: false,
                error: "Unauthorized"
            });
        }

        console.log("✅ Cozy secret accepted.");

        const cleanName = cleanUsername(username);
        const level = validCozyLevel(cozyLevel);

        if (!cleanName) {
            return res.status(400).json({
                success: false,
                error: "Missing username"
            });
        }

        if (level === null) {
            return res.status(400).json({
                success: false,
                error: "Invalid cozy level"
            });
        }

        const streamDate = getToday();

        const saveResult = await saveCozy(
            cleanName,
            level,
            streamDate
        );

        console.log("🧸 Cozy save result:", saveResult.saved);

        if (!saveResult.row) {
            throw new Error("Could not save or find Cozy result.");
        }

        const cozyRecord = saveResult.row;

        console.log("🧸 Cozy record ID:", cozyRecord.id);
        console.log(
            "🧸 Discord already posted:",
            cozyRecord.discord_posted
        );

        if (cozyRecord.discord_posted) {
            console.log(
                "🧸 Cozy result was already posted to Discord."
            );

            return res.json({
                success: true,
                duplicate: true,
                alreadyPosted: true,
                username: cozyRecord.username,
                cozyLevel: cozyRecord.cozy_level,
                message: "This Cozy result was already posted today."
            });
        }

        console.log(
            "🧸 Discord channel ID:",
            TOP_COZY_CHANNEL_ID
        );

        if (!TOP_COZY_CHANNEL_ID) {
            throw new Error(
                "TOP_COZY_CHANNEL_ID is missing from Render environment variables."
            );
        }

        console.log(
            "🔌 Discord client ready state:",
            client.isReady()
        );

        if (!client.isReady()) {
            throw new Error(
                "Discord bot is not connected yet."
            );
        }

        console.log("🔎 Fetching Discord channel...");

        const channel = await client.channels.fetch(
            TOP_COZY_CHANNEL_ID
        );

        if (!channel) {
            throw new Error("Top Cozy channel not found.");
        }

        console.log(
            "✅ Discord
```
