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

app.get("/", (req, res) => {
    res.send("🧸 Cozy Bot is awake!");
});

app.post("/cozy", async (req, res) => {
    console.log("🧸 COZY POST RECEIVED:", req.body);

    try {
        const { username, cozyLevel, secret } = req.body;

        if (!COZY_WEBHOOK_SECRET || secret !== COZY_WEBHOOK_SECRET) {
            console.log("❌ Cozy secret rejected.");

            return res.status(401).json({
                success: false,
                error: "Unauthorized"
            });
        }

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

        const wasSaved = await saveCozy(
            cleanName,
            level,
            streamDate
        );

        console.log("🧸 Cozy save result:", wasSaved);
        console.log("🧸 Discord channel ID:", TOP_COZY_CHANNEL_ID);

        if (!wasSaved) {
            console.log("🧸 Cozy result was already saved today.");

            return res.json({
                success: true,
                duplicate: true,
                message: "This Cozy result was already saved today."
            });
        }

        const channel = await client.channels.fetch(
            TOP_COZY_CHANNEL_ID
        );

        if (!channel) {
            throw new Error("Top Cozy channel not found.");
        }

        const displayDate = getDisplayDate();

        const embed = new EmbedBuilder()
            .setTitle("🧸 TOP COZY!")
            .setDescription(
                `✨ **${cleanName}** was today's Top Cozy!\n\n` +
                `💜 Cozy Level: **${level}%**\n` +
                `📅 ${displayDate}\n\n` +
                `☕ Thank you for being cozy! 💜`
            );

        await channel.send({
            embeds: [embed]
        });

        console.log(
            `🧸 Final Cozy saved: ${cleanName} - ${level}% - ${displayDate}`
        );

        return res.json({
            success: true,
            duplicate: false,
            username: cleanName,
            cozyLevel: level,
            date: displayDate
        });

    } catch (error) {
        console.error("❌ Cozy error:", error);

        return res.status(500).json({
            success: false,
            error: "Server error"
        });
    }
});

client.on("messageCreate", async (message) => {
    if (message.author.bot) return;

    const content = message.content.trim();

    if (!content.toLowerCase().startsWith("!mycozy")) {
        return;
    }

    const username = message.author.username;

    try {
        const history = await getCozyHistory(username);
        const winCount = await getCozyWinCount(username);

        if (history.length === 0) {
            await message.reply(
                `🧸 **${username}**, you don't have any Top Cozy wins yet!\n\n` +
                `☕ Keep hanging out and being cozy! 💜`
            );

            return;
        }

        const historyText = history
            .map((entry) => {
                const date = new Date(entry.stream_date)
                    .toLocaleDateString("en-US", {
                        timeZone: TIMEZONE,
                        year: "numeric",
                        month: "long",
                        day: "numeric"
                    });

                return `📅 **${date}** — **${entry.cozy_level}%**`;
            })
            .join("\n");

        const embed = new EmbedBuilder()
            .setTitle(`🧸 ${username}'s Cozy History`)
            .setDescription(
                `🏆 **${winCount} Top Cozy ` +
                `${winCount === 1 ? "win" : "wins"}**\n\n` +
                `${historyText}\n\n` +
                `☕ Keep being cozy! 💜`
            );

        await message.reply({
            embeds: [embed]
        });

    } catch (error) {
        console.error("❌ !mycozy error:", error);

        await message.reply(
            "🧸 Oops! I couldn't retrieve your Cozy history right now."
        );
    }
});

client.once("ready", () => {
    console.log(
        `🧸 Cozy Bot online as ${client.user.tag}`
    );
});

async function start() {
    try {
        await initializeDatabase();

        app.listen(PORT, () => {
            console.log(
                `🧸 Cozy web server running on port ${PORT}`
            );
        });

        await client.login(
            process.env.DISCORD_TOKEN
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