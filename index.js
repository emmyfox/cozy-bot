
require("dotenv").config();

const express = require("express");
const {
    Client,
    GatewayIntentBits,
    ChannelType,
    PermissionFlagsBits
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

const DISCORD_READY_TIMEOUT_MS = 30000;

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
// DISCORD CONNECTION LOGGING
// ==================================================

client.once("ready", () => {
    console.log(`🧸 Cozy Bot ONLINE as ${client.user.tag}`);
    console.log(`🧸 Discord user ID: ${client.user.id}`);
    console.log(`🧸 Target Top Cozy channel: ${TOP_COZY_CHANNEL_ID}`);
});

client.on("error", (error) => {
    console.error("❌ Discord client error:", error);
});

client.on("shardError", (error) => {
    console.error("❌ Discord shard error:", error);
});

client.on("warn", (message) => {
    console.warn("⚠️ Discord warning:", message);
});

client.on("debug", (message) => {
    if (/heartbeat|session|reconnect|identify/i.test(message)) {
        console.log("🔎 Discord:", message);
    }
});

// ==================================================
// WAIT FOR DISCORD WITH A TIMEOUT
// ==================================================

function waitForDiscordReady(timeoutMs = DISCORD_READY_TIMEOUT_MS) {
    if (client.isReady()) {
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        let settled = false;

        const cleanup = () => {
            clearTimeout(timeout);
            client.off("ready", onReady);
            client.off("shardDisconnect", onDisconnect);
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

        const onReady = () => {
            console.log("✅ Discord is ready to post.");
            finish();
        };

        const onDisconnect = () => {
            console.warn(
                "⚠️ Discord disconnected while waiting for readiness."
            );
        };

        const timeout = setTimeout(() => {
            finish(
                new Error(
                    `Discord did not become ready within ${timeoutMs / 1000} seconds.`
                )
            );
        }, timeoutMs);

        client.once("ready", onReady);
        client.on("shardDisconnect", onDisconnect);

        // Check again after attaching listeners to avoid a race.
        if (client.isReady()) {
            finish();
        }
    });
}

// ==================================================
// WEB SERVER
// ==================================================

app.get("/", (req, res) => {
    res.status(200).send("🧸 Cozy Bot is alive!");
});

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
        // ------------------------------------------
        // WAIT FOR DISCORD
        // ------------------------------------------

        if (!client.isReady()) {
            console.log(
                "⏳ Waiting up to 30 seconds for Discord to connect..."
            );

            await waitForDiscordReady();
        }

        // ------------------------------------------
        // FETCH TARGET CHANNEL
        // ------------------------------------------

        console.log(
            `🔎 Fetching Top Cozy channel ${TOP_COZY_CHANNEL_ID}...`
        );

        const channel = await client.channels.fetch(
            TOP_COZY_CHANNEL_ID
        );

        if (!channel) {
            throw new Error(
                `Top Cozy channel ${TOP_COZY_CHANNEL_ID} was not found.`
            );
        }

        if (!channel.isTextBased() || !channel.send) {
            throw new Error(
                "The configured Top Cozy channel cannot receive messages."
            );
        }

        // ------------------------------------------
        // CHECK BOT PERMISSIONS WHEN AVAILABLE
        // ------------------------------------------

        if (channel.guild && client.user) {
            const me = await channel.guild.members.fetch(
                client.user.id
            );

            const permissions = channel.permissionsFor(me);

            if (
                !permissions ||
                !permissions.has(PermissionFlagsBits.ViewChannel) ||
                !permissions.has(PermissionFlagsBits.SendMessages)
            ) {
                throw new Error(
                    "Cozy Bot is missing View Channel or Send Messages permission."
                );
            }

            if (
                !permissions.has(
                    PermissionFlagsBits.EmbedLinks
                )
            ) {
                throw new Error(
                    "Cozy Bot is missing Embed Links permission in the Top Cozy channel."
                );
            }
        }

        // ------------------------------------------
        // FORMAT DATE
        // ------------------------------------------

        const date = new Date(
            `${streamDate}T00:00:00Z`
        );

        if (Number.isNaN(date.getTime())) {
            throw new Error(
                `Invalid stream date: ${streamDate}`
            );
        }

        const formattedDate = date.toLocaleDateString(
            "en-US",
            {
                timeZone: "UTC",
                month: "long",
                day: "numeric",
                year: "numeric"
            }
        );

        // ------------------------------------------
        // BUILD TOP COZY EMBED
        // ------------------------------------------

        const embed = {
            title: "🧸 TOP COZY!",
            description:
                `✨ **${username}** was today's Top Cozy!\n\n` +
                `💜 Cozy Level: **${cozyLevel}%**\n` +
                `📅 ${formattedDate}\n\n` +
                `☕ Thank you for being cozy! 💜`,
            color: 0xC084FC
        };

        // ------------------------------------------
        // SEND TO DISCORD
        // ------------------------------------------

        console.log(
            `📨 Posting Top Cozy: ${username} at ${cozyLevel}%...`
        );

        const sentMessage = await channel.send({
            embeds: [embed]
        });

        console.log(
            `✅ Discord accepted Top Cozy message. Message ID: ${sentMessage.id}`
        );

        // ------------------------------------------
        // MARK DATABASE RECORD AS POSTED
        // ------------------------------------------

        await markDiscordPosted(recordId);

        console.log(
            `✅ TOP COZY POSTED: ${username} ${cozyLevel}% - ${streamDate}`
        );
    } catch (error) {
        console.error(
            "❌ Background Discord post failed:",
            error
        );

        console.error(
            "❌ Posting details:",
            {
                username,
                cozyLevel,
                streamDate,
                recordId,
                discordReady: client.isReady(),
                channelId: TOP_COZY_CHANNEL_ID,
                errorCode: error.code,
                errorMessage: error.message
            }
        );

        // Do not mark as posted if sending failed.
        // The record remains available for a later retry.
    }
}

// ==================================================
// MIX IT UP → RENDER
// Existing endpoint preserved
// ==================================================

app.post("/cozy", async (req, res) => {
    try {
        console.log("🧸 COZY POST RECEIVED:", {
            username: req.body.username,
            cozyLevel: req.body.cozyLevel,
            streamDate: req.body.streamDate
        });

        // ------------------------------------------
        // CHECK SECRET
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

        const username = String(
            req.body.username || ""
        ).trim();

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
                message:
                    "Cozy level must be between 0 and 100."
            });
        }

        // ------------------------------------------
        // STREAM DATE
        // ------------------------------------------

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

        console.log(`📅 Using stream date: ${streamDate}`);

        // ------------------------------------------
        // SAVE TO DATABASE
        // ------------------------------------------

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

        // ------------------------------------------
        // RESPOND TO MIX IT UP IMMEDIATELY
        // ------------------------------------------

        res.json({
            success: true,
            duplicate: saveResult.row.discord_posted,
            username,
            cozyLevel,
            streamDate
        });

        // ------------------------------------------
        // POST TO DISCORD IN BACKGROUND
        // ------------------------------------------

        if (!saveResult.row.discord_posted) {
            void postTopCozyInBackground(
                username,
                cozyLevel,
                streamDate,
                recordId
            );
        } else {
            console.log(
                "ℹ️ This Cozy result is already marked as posted."
            );
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
// Existing history command preserved
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

        // ------------------------------------------
        // NO WINS
        // ------------------------------------------

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

        // ------------------------------------------
        // HISTORY
        // ------------------------------------------

        const historyText = history
            .map((record) => {
                const rawDate = record.stream_date;

                const dateString =
                    rawDate instanceof Date
                        ? rawDate.toISOString().slice(0, 10)
                        : String(rawDate).slice(0, 10);

                const date = new Date(
                    `${dateString}T00:00:00Z`
                );

                const formattedDate = date.toLocaleDateString(
                    "en-US",
                    {
                        timeZone: "UTC",
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

    if (!DISCORD_TOKEN) {
        throw new Error("DISCORD_BOT_TOKEN is missing.");
    }

    if (!TOP_COZY_CHANNEL_ID) {
        throw new Error("TOP_COZY_CHANNEL_ID is missing.");
    }

    if (!COZY_WEBHOOK_SECRET) {
        throw new Error("COZY_WEBHOOK_SECRET is missing.");
    }

    // ------------------------------------------
    // INITIALIZE DATABASE
    // ------------------------------------------

    await initializeDatabase();

    console.log("🧸 Cozy database ready!");

    // ------------------------------------------
    // START WEB SERVER
    // ------------------------------------------

    app.listen(PORT, "0.0.0.0", () => {
        console.log(
            `🧸 Cozy web server running on port ${PORT}`
        );
    });

    // ------------------------------------------
    // CONNECT TO DISCORD
    // ------------------------------------------

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
