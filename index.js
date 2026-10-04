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

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const TOP_COZY_CHANNEL_ID = process.env.TOP_COZY_CHANNEL_ID;
const COZY_WEBHOOK_SECRET = process.env.COZY_WEBHOOK_SECRET;

// ==================================================
// DISCORD
// ==================================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
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

// ==================================================
// TOP COZY DISCORD POST
// ==================================================

async function postTopCozy(username, cozyLevel, streamDate) {
    if (!client.isReady()) {
        throw new Error("Discord bot is not ready.");
    }

    const channel = await client.channels.fetch(
        TOP_COZY_CHANNEL_ID
    );

    if (!channel) {
        throw new Error("Top Cozy channel was not found.");
    }

    const date = new Date(`${streamDate}T00:00:00`);

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

    console.log(
        `✅ TOP COZY POSTED: ${username} - ${cozyLevel}% - ${streamDate}`
    );
}

// ==================================================
// MIX IT UP → COZY WEBHOOK
// ==================================================

app.post("/cozy", async (req, res) => {
    try {
        console.log("🧸 COZY POST RECEIVED:", {
            username: req.body.username,
            cozyLevel: req.body.cozyLevel,
            streamDate: req.body.streamDate
        });

        // ------------------------------------------
        // SECRET
        // ------------------------------------------

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

        // ------------------------------------------
        // USERNAME
        // ------------------------------------------

        const username =
            String(req.body.username || "").trim();

        if (!username) {
            return res.status(400).json({
                success: false,
                message: "Username is required."
            });
        }

        // ------------------------------------------
        // COZY LEVEL
        // ------------------------------------------

        const cozyLevel = Number(req.body.cozyLevel);

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

        // ------------------------------------------
        // DATE
        // ------------------------------------------

        // If Mix It Up sends a streamDate, use it.
        // Otherwise use today's date.
        let streamDate = String(
            req.body.streamDate || ""
        ).trim();

        if (!/^\d{4}-\d{2}-\d{2}$/.test(streamDate)) {
            streamDate = new Intl.DateTimeFormat(
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

        // ------------------------------------------
        // SAVE
        // ------------------------------------------

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

        // ------------------------------------------
        // ALREADY POSTED?
        // ------------------------------------------

        if (saveResult.row.discord_posted) {
            console.log(
                "ℹ️ This Cozy result was already posted."
            );

            return res.json({
                success: true,
                duplicate: true,
                message: "Already posted."
            });
        }

        // ------------------------------------------
        // POST TO DISCORD
        // ------------------------------------------

        await postTopCozy(
            username,
            cozyLevel,
            streamDate
        );

        // ------------------------------------------
        // MARK POSTED
        // ------------------------------------------

        await markDiscordPosted(recordId);

        console.log(
            "✅ Cozy record marked as posted."
        );

        return res.json({
            success: true,
            duplicate: false,
            username,
            cozyLevel,
            streamDate
        });

    } catch (error) {
        console.error(
            "❌ /cozy ERROR:",
            error
        );

        return res.status(500).json({
            success: false,
            message: error.message
        });
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

        const history =
            await getCozyHistory(username);

        const winCount =
            await getCozyWinCount(username);

        if (!history || history.length === 0) {
            return message.reply({
                embeds: [
                    {
                        title:
                            `🧸 ${username}'s Cozy History`,
                        description:
                            "You don't have any Top Cozy wins yet! ☕💜",
                        color: 0xC084FC
                    }
                ]
            });
        }

        const historyText = history
            .map((record) => {
                const date = new Date(
                    `${record.stream_date}T00:00:00`
                );

                const formattedDate =
                    date.toLocaleDateString(
                        "en-US",
                        {
                            month: "long",
                            day: "numeric",
                            year: "numeric"
                        }
                    );

                return (
                    `📅 ${formattedDate} — ` +
                    `**${record.cozy_level}%**`
                );
            })
            .join("\n");

        return message.reply({
            embeds: [
                {
                    title:
                        `🧸 ${username}'s Cozy History`,
                    description:
                        `🏆 **${winCount} Top Cozy win${winCount === 1 ? "" : "s"}**\n\n` +
                        historyText +
                        `\n\n☕ Keep being cozy! 💜`,
                    color: 0xC084FC
                }
            ]
        });

    } catch (error) {
        console.error(
            "❌ !mycozy ERROR:",
            error
        );
    }
});

// ==================================================
// START
// ==================================================

async function start() {
    console.log("🧸 Starting Cozy Bot...");

    if (!DISCORD_TOKEN) {
        throw new Error(
            "DISCORD_TOKEN is missing."
        );
    }

    if (!TOP_COZY_CHANNEL_ID) {
        throw new Error(
            "TOP_COZY_CHANNEL_ID is missing."
        );
    }

    if (!COZY_WEBHOOK_SECRET) {
        throw new Error(
            "COZY_WEBHOOK_SECRET is missing."
        );
    }

    await initializeDatabase();

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

    await client.login(DISCORD_TOKEN);
}

start().catch((error) => {
    console.error(
        "❌ Failed to start Cozy Bot:",
        error
    );
});