
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

// ==================================================
// DISCORD CONNECTION DIAGNOSTICS
// ==================================================

client.once("ready", () => {
    console.log(`🧸 Cozy Bot ONLINE as ${client.user.tag}`);
});

client.on("error", (error) => {
    console.error("❌ Discord client error:", error);
});

client.on("warn", (message) => {
    console.warn("⚠️ Discord warning:", message);
});

client.on("shardReady", (shardId) => {
    console.log(`✅ Discord shard ${shardId} connected and ready.`);
});

client.on("shardReconnecting", (shardId) => {
    console.log(`🔄 Discord shard ${shardId} reconnecting.`);
});

client.on("shardDisconnect", (event, shardId) => {
    console.error(
        `❌ Discord shard ${shardId} disconnected.`,
        {
            code: event?.code,
            reason: event?.reason
        }
    );
});

client.on("shardError", (error, shardId) => {
    console.error(
        `❌ Discord shard ${shardId} error:`,
        error
    );
});

client.on("debug", (message) => {
    // Log connection-related messages without flooding
    // the Render logs with every Discord debug message.
    if (/gateway|heartbeat|identify|reconnect|session|error|close|disconnect|connect/i.test(message)) {
        console.log("🔎 Discord debug:", message);
    }
});

// ==================================================
// WAIT FOR DISCORD TO BECOME READY
// ==================================================

function waitForDiscordReady(timeoutMs = 30000) {
    if (client.isReady()) {
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        let settled = false;

        const cleanup = () => {
            clearTimeout(timeout);
            client.off("ready", onReady);
        };

        const finish = (error) => {
            if (settled) return;
            settled = true;
            cleanup();

            if (error) {
                reject(error);
            } else {
                resolve();
            }
        };

        const onReady = () => finish();

        const timeout = setTimeout(() => {
            finish(
                new Error(
                    "Discord did not become ready within 30 seconds."
                )
            );
        }, timeoutMs);

        client.once("ready", onReady);

        // Check again in case the client became ready
        // while the listener was being registered.
        if (client.isReady()) {
            finish();
        }
    });
}

// ==================================================
// WEB SERVER
// ==================================================

app.get("/", (req, res) => {
    res.send("🧸 Cozy Bot is alive!");
});

// ==================================================
// FORMAT A STREAM DATE CONSISTENTLY
// ==================================================

function formatStreamDate(streamDate) {
    const date = new Date(`${streamDate}T00:00:00Z`);

    if (Number.isNaN(date.getTime())) {
        return streamDate;
    }

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

async function postTopCozyInBackground(
    username,
    cozyLevel,
    streamDate,
    recordId
) {
    try {
        if (!client.isReady()) {
            console.log(
                "⏳ Waiting up to 30 seconds for Discord to connect..."
            );

            await waitForDiscordReady();
        }

        console.log("🔎 Fetching Top Cozy Discord channel...");

        const channel = await client.channels.fetch(
            TOP_COZY_CHANNEL_ID
        );

        if (!channel) {
            throw new Error(
                "Top Cozy channel was not found. Check TOP_COZY_CHANNEL_ID."
            );
        }

        if (
            !channel.isTextBased() ||
            typeof channel.send !== "function"
        ) {
            throw new Error(
                "The configured Top Cozy channel cannot receive messages."
            );
        }

        // Check permissions when the channel belongs to a server.
        if (channel.guild) {
            const botMember = await channel.guild.members.fetch(
                client.user.id
            );

            const permissions = channel.permissionsFor(botMember);

            if (
                !permissions ||
                !permissions.has([
                    "ViewChannel",
                    "SendMessages",
                    "EmbedLinks"
                ])
            ) {
                throw new Error(
                    "The bot needs View Channel, Send Messages, and Embed Links permissions in the Top Cozy channel."
                );
            }
        }

        const formattedDate = formatStreamDate(streamDate);

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

        // Only mark the database record as posted after
        // Discord confirms the message was sent.
        await markDiscordPosted(recordId);

        console.log(
            `✅ TOP COZY POSTED: ${username} ${cozyLevel}% - ${streamDate}`
        );
    } catch (error) {
        console.error("❌ Background Discord post failed:", error);

        console.error("❌ Posting details:", {
            username,
            cozyLevel,
            streamDate,
            recordId,
            discordReady: client.isReady(),
            websocketStatus: client.ws.status,
            channelId: TOP_COZY_CHANNEL_ID,
            errorCode: error.code,
            errorMessage: error.message
        });
    }
}

// ==================================================
// MIX IT UP → RENDER WEBHOOK
// ==================================================

app.post("/cozy", async (req, res) => {
    try {
        console.log("🧸 COZY POST RECEIVED:", {
            username: req.body.username,
            cozyLevel: req.body.cozyLevel,
            streamDate: req.body.streamDate
        });

        // Validate the shared secret.
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

        const username = String(
            req.body.username || ""
        ).trim();

        if (!username) {
            return res.status(400).json({
                success: false,
                message: "Username is required."
            });
        }

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

        let streamDate = String(
            req.body.streamDate || ""
        ).trim();

        // Default to today's date in the New York time zone.
        if (!/^\d{4}-\d{2}-\d{2}$/.test(streamDate)) {
            streamDate = new Intl.DateTimeFormat("en-CA", {
                timeZone: "America/New_York",
                year: "numeric",
                month: "2-digit",
                day: "2-digit"
            }).format(new Date());
        }

        console.log(`📅 Using stream date: ${streamDate}`);

        const saveResult = await saveCozy(
            username,
            cozyLevel,
            streamDate
        );

        console.log("📊 DB Result:", saveResult);

        if (!saveResult || !saveResult.row) {
            return res.status(500).json({
                success: false,
                message: "Could not save Cozy record."
            });
        }

        const recordId = saveResult.row.id;

        // Respond to Mix It Up without waiting for Discord.
        res.json({
            success: true,
            duplicate: saveResult.row.discord_posted,
            username,
            cozyLevel,
            streamDate
        });

        // Send the Discord post separately.
        if (!saveResult.row.discord_posted) {
            void postTopCozyInBackground(
                username,
                cozyLevel,
                streamDate,
                recordId
            );
        } else {
            console.log(
                "ℹ️ This Cozy result was already posted."
            );
        }
    } catch (error) {
        console.error("❌ /cozy ERROR:", error);

        if (!res.headersSent) {
            return res.status(500).json({
                success: false,
                message: "An internal error occurred."
            });
        }
    }
});

// ==================================================
// !MYCOZY
// ==================================================

client.on("messageCreate", async (message) => {
    try {
        if (message.author.bot) {
            return;
        }

        if (
            message.content.trim().toLowerCase() !== "!mycozy"
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
                        description:
                            "You don't have any Top Cozy wins yet! ☕💜",
                        color: 0xC084FC
                    }
                ]
            });
        }

        const historyText = history
            .map((record) => {
                // Handle either a date string or a PostgreSQL Date.
                const rawDate = record.stream_date;

                const streamDate =
                    typeof rawDate === "string"
                        ? rawDate.slice(0, 10)
                        : new Date(rawDate)
                              .toISOString()
                              .slice(0, 10);

                return (
                    `📅 ${formatStreamDate(streamDate)} — ` +
                    `**${record.cozy_level}%**`
                );
            })
            .join("\n");

        return message.reply({
            embeds: [
                {
                    title: `🧸 ${username}'s Cozy History`,
                    description:
                        `🏆 **${winCount} Top Cozy win${winCount === 1 ? "" : "s"}**\n\n` +
                        historyText +
                        "\n\n☕ Keep being cozy! 💜",
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

    if (!DISCORD_TOKEN) {
        throw new Error("DISCORD_BOT_TOKEN is missing.");
    }

    if (!TOP_COZY_CHANNEL_ID) {
        throw new Error("TOP_COZY_CHANNEL_ID is missing.");
    }

    if (!COZY_WEBHOOK_SECRET) {
        throw new Error("COZY_WEBHOOK_SECRET is missing.");
    }

    await initializeDatabase();

    // Start the web server so Render can detect the service.
    app.listen(PORT, "0.0.0.0", () => {
        console.log(
            `🧸 Cozy web server running on port ${PORT}`
        );
    });

    console.log("🚀 Connecting Cozy Bot to Discord...");

    try {
        await client.login(DISCORD_TOKEN);

        console.log(
            "✅ Discord login method completed successfully."
        );
    } catch (error) {
        console.error(
            "❌ Critical Discord Login Failure:",
            error
        );
    }
}

// ==================================================
// START
// ==================================================

start().catch((error) => {
    console.error("❌ Failed to start Cozy Bot:", error);
});
