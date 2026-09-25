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

// ======================================================
// DISCORD
// ======================================================

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const TOP_COZY_CHANNEL_ID = process.env.TOP_COZY_CHANNEL_ID;
const COZY_WEBHOOK_SECRET = process.env.COZY_WEBHOOK_SECRET;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// ======================================================
// WEB SERVER
// ======================================================

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

app.get("/", (req, res) => {
    res.send("🧸 Cozy Bot is awake!");
});

// ======================================================
// SETTINGS
// ======================================================

const TIMEZONE =
    process.env.TIMEZONE || "America/New_York";

// ======================================================
// HELPERS
// ======================================================

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

// ======================================================
// DISCORD READY
// ======================================================

client.once("ready", () => {
    console.log(
        `🧸 Cozy Bot ONLINE as ${client.user.tag}!`
    );client.once("ready", () => {
    console.log(
        `🧸 Cozy Bot ONLINE as ${client.user.tag}!`
    );

    console.log(
        `🧸 Discord User ID: ${client.user.id}`
    );
});

client.on("error", (error) => {
    console.error("❌ DISCORD CLIENT ERROR:", error);
});

client.on("warn", (warning) => {
    console.warn("⚠️ DISCORD WARNING:", warning);
});

client.on("debug", (info) => {
    console.log("🔎 DISCORD DEBUG:", info);
});

    console.log(
        `🧸 Discord User ID: ${client.user.id}`
    );
});

// ======================================================
// SEND TOP COZY ANNOUNCEMENT
// ======================================================

async function sendTopCozyMessage(
    username,
    level,
    displayDate
) {
    const channel =
        await client.channels.fetch(
            TOP_COZY_CHANNEL_ID
        );

    if (!channel) {
        throw new Error(
            "Top Cozy Discord channel could not be found."
        );
    }

    const description =
        `✨ **${username}** was today's Top Cozy!\n\n` +
        `💜 Cozy Level: **${level}%**\n` +
        `📅 ${displayDate}\n\n` +
        `☕ Thank you for being cozy! 💜`;

    await channel.send({
        embeds: [
            {
                title: "🧸 TOP COZY!",
                description: description
            }
        ]
    });
}

// ======================================================
// COZY WEBHOOK FROM MIX IT UP
// ======================================================

app.post("/cozy", async (req, res) => {
    console.log(
        "🧸 COZY POST RECEIVED:",
        {
            username: req.body.username,
            cozyLevel: req.body.cozyLevel,
            secret: "[hidden]"
        }
    );

    try {
        const username = req.body.username;
        const cozyLevel = req.body.cozyLevel;
        const secret = req.body.secret;

        const receivedSecret =
            String(secret || "")
                .replace(/\r/g, "")
                .replace(/\n/g, "")
                .trim();

        const savedSecret =
            String(COZY_WEBHOOK_SECRET || "")
                .replace(/\r/g, "")
                .replace(/\n/g, "")
                .trim();

        if (!savedSecret) {
            return res.status(500).json({
                success: false,
                error: "Server secret is not configured"
            });
        }

        if (receivedSecret !== savedSecret) {
            console.log(
                "❌ Cozy secret rejected."
            );

            return res.status(401).json({
                success: false,
                error: "Unauthorized"
            });
        }

        console.log(
            "✅ Cozy secret accepted."
        );

        const cleanName =
            cleanUsername(username);

        const level =
            validCozyLevel(cozyLevel);

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

        const saveResult =
            await saveCozy(
                cleanName,
                level,
                streamDate
            );

        console.log(
            "🧸 Cozy save result:",
            saveResult.saved
        );

        if (!saveResult.row) {
            throw new Error(
                "Could not save or find Cozy result."
            );
        }

        const cozyRecord =
            saveResult.row;

        console.log(
            "🧸 Cozy record ID:",
            cozyRecord.id
        );

        console.log(
            "🧸 Discord already posted:",
            cozyRecord.discord_posted
        );

        // Already posted today
        if (cozyRecord.discord_posted) {
            return res.json({
                success: true,
                duplicate: true,
                alreadyPosted: true,
                username: cozyRecord.username,
                cozyLevel: cozyRecord.cozy_level,
                message:
                    "This Cozy result was already posted today."
            });
        }

        // Discord bot must be connected
        if (!client.isReady()) {
            console.log(
                "⚠️ Discord bot is not ready yet."
            );

            return res.status(503).json({
                success: false,
                error:
                    "Discord bot is not connected yet."
            });
        }

        const displayDate =
            getDisplayDate();

        console.log(
            "🧸 Sending Top Cozy message..."
        );

        await sendTopCozyMessage(
            cleanName,
            level,
            displayDate
        );

        console.log(
            "✅ Top Cozy message sent to Discord!"
        );

        await markDiscordPosted(
            cozyRecord.id
        );

        console.log(
            "💾 Discord post marked in database."
        );

        return res.json({
            success: true,
            duplicate: !saveResult.saved,
            alreadyPosted: false,
            username: cleanName,
            cozyLevel: level,
            date: displayDate
        });

    } catch (error) {
        console.error(
            "❌ Cozy error:",
            error
        );

        return res.status(500).json({
            success: false,
            error: "Server error"
        });
    }
});

// ======================================================
// !MYCOZY
// ======================================================

async function handleMyCozy(message) {
    const content =
        message.content.trim();

    if (
        !content
            .toLowerCase()
            .startsWith("!mycozy")
    ) {
        return;
    }

    const parts =
        content.split(/\s+/);

    const username =
        parts.length > 1
            ? cleanUsername(parts[1])
            : message.author.username;

    try {
        const history =
            await getCozyHistory(username);

        const winCount =
            await getCozyWinCount(username);

        if (history.length === 0) {
            await message.reply(
                `🧸 **${username}**, you don't have any Top Cozy wins yet!\n\n` +
                `☕ Keep hanging out and being cozy! 💜`
            );

            return;
        }

        const historyText =
            history
                .map((entry) => {
                    const date =
                        new Date(
                            entry.stream_date
                        ).toLocaleDateString(
                            "en-US",
                            {
                                timeZone: TIMEZONE,
                                year: "numeric",
                                month: "long",
                                day: "numeric"
                            }
                        );

                    return (
                        `📅 **${date}** — **${entry.cozy_level}%**`
                    );
                })
                .join("\n");

        const text =
            `🏆 **${winCount} Top Cozy ` +
            `${winCount === 1 ? "win" : "wins"}**\n\n` +
            `${historyText}\n\n` +
            `☕ Keep being cozy! 💜`;

        await message.channel.send({
            embeds: [
                {
                    title:
                        `🧸 ${username}'s Cozy History`,
                    description: text
                }
            ]
        });

    } catch (error) {
        console.error(
            "❌ !mycozy error:",
            error
        );

        await message.reply(
            "⚠️ I couldn't retrieve your Cozy history right now."
        );
    }
}

// ======================================================
// DISCORD MESSAGES
// ======================================================

client.on(
    "messageCreate",
    async (message) => {
        if (message.author.bot) {
            return;
        }

        await handleMyCozy(message);
    }
);

// ======================================================
// START
// ======================================================

async function start() {
    try {
        console.log(
            "🧸 Starting Cozy Bot..."
        );

        if (!DISCORD_TOKEN) {
            throw new Error(
                "DISCORD_TOKEN is not configured."
            );
        }

        if (!TOP_COZY_CHANNEL_ID) {
            throw new Error(
                "TOP_COZY_CHANNEL_ID is not configured."
            );
        }

        if (!COZY_WEBHOOK_SECRET) {
            throw new Error(
                "COZY_WEBHOOK_SECRET is not configured."
            );
        }

        console.log(
            "🧸 Initializing database..."
        );

        await initializeDatabase();

        console.log(
            "✅ Database initialized."
        );

        app.listen(
            PORT,
            "0.0.0.0",
            () => {
                console.log(
                    `🧸 Cozy web server running on port ${PORT}`
                );
            }
        );

        console.log(
            "🚀 Connecting Cozy Bot to Discord..."
        );

        await client.login(
            DISCORD_TOKEN
        );

    } catch (error) {
        console.error(
            "❌ Failed to start Cozy Bot:",
            error
        );

        process.exit(1);
    }
}

start();