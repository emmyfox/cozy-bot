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

// ==================================================
// ENVIRONMENT VARIABLES
// ==================================================

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const TOP_COZY_CHANNEL_ID = process.env.TOP_COZY_CHANNEL_ID;
const COZY_WEBHOOK_SECRET = process.env.COZY_WEBHOOK_SECRET;

const PORT = process.env.PORT || 10000;

// ==================================================
// DISCORD CLIENT (WITH BYPASS SETTINGS)
// ==================================================

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

// ==================================================
// DISCORD EVENTS
// ==================================================

client.once("ready", () => {
    console.log(
        `🧸 Cozy Bot ONLINE as ${client.user.tag}`
    );
});

client.on("error", (error) => {
    console.error(
        "❌ DISCORD CLIENT ERROR:",
        error
    );
});

client.on("warn", (warning) => {
    console.warn(
        "⚠️ DISCORD WARNING:",
        warning
    );
});

client.on("shardReconnecting", (id) => {
    console.log(
        "🔄 Discord shard reconnecting:",
        id
    );
});

client.on("shardReady", (id) => {
    console.log(
        "🟢 Discord shard ready:",
        id
    );
});

client.on("shardDisconnect", (event, id) => {
    console.log(
        "🔴 Discord shard disconnected:",
        id,
        "code:",
        event.code,
        "reason:",
        event.reason
    );
});

client.on("shardError", (error, id) => {
    console.error(
        "❌ Discord shard error:",
        id,
        error
    );
});

// ==================================================
// EXPRESS WEB SERVER
// ==================================================

const app = express();

app.use(express.json());

app.get("/", (req, res) => {
    res.send("🧸 Cozy Bot is alive!");
});

// ==================================================
// SEND TOP COZY MESSAGE
// ==================================================

async function sendTopCozyMessage(
    username,
    cozyLevel,
    streamDate
) {
    try {

        const channel =
            await client.channels.fetch(
                TOP_COZY_CHANNEL_ID
            );

        if (!channel) {
            throw new Error(
                "Top Cozy Discord channel was not found."
            );
        }

        const date = new Date(
            streamDate + "T00:00:00"
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
            "✅ Top Cozy message sent to Discord."
        );

        return true;

    } catch (error) {

        console.error(
            "❌ Failed to send Top Cozy message:",
            error
        );

        return false;
    }
}

// ==================================================
// COZY WEBHOOK
// ==================================================

app.post("/cozy", async (req, res) => {

    try {

        console.log(
            "🧸 COZY POST RECEIVED:",
            {
                username: req.body.username,
                cozyLevel: req.body.cozyLevel,
                secret: req.body.secret
                    ? "[hidden]"
                    : undefined
            }
        );

        // ------------------------------------------
        // CHECK SECRET
        // ------------------------------------------

        if (
            !req.body.secret ||
            req.body.secret !== COZY_WEBHOOK_SECRET
        ) {

            console.log(
                "❌ Invalid Cozy secret."
            );

            return res.status(401).json({
                success: false,
                message: "Invalid secret."
            });
        }

        console.log(
            "✅ Cozy secret accepted."
        );

        // ------------------------------------------
        // USERNAME
        // ------------------------------------------

        const username =
            String(
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

        const cozyLevel =
            Number(
                req.body.cozyLevel
            );

        if (
            !Number.isInteger(cozyLevel) ||
            cozyLevel < 0 ||
            cozyLevel > 100
        ) {

            return res.status(400).json({
                success: false,
                message:
                    "Cozy level must be a whole number from 0 to 100."
            });
        }

        // ------------------------------------------
        // DATE
        // ------------------------------------------

        const streamDate =
            new Date()
                .toISOString()
                .slice(0, 10);

        // ------------------------------------------
        // SAVE TO DATABASE
        // ------------------------------------------

        const saveResult =
            await saveCozy(
                username,
                cozyLevel,
                streamDate
            );

        console.log(
            "🧸 Cozy save result:",
            saveResult.saved
        );

        if (!saveResult.row) {

            return res.status(500).json({
                success: false,
                message:
                    "Could not save or find Cozy record."
            });
        }

        const recordId =
            saveResult.row.id;

        console.log(
            "🧸 Cozy record ID:",
            recordId
        );

        // ------------------------------------------
        // DON'T POST TWICE
        // ------------------------------------------

        if (
            saveResult.row.discord_posted
        ) {

            console.log(
                "ℹ️ Discord already posted."
            );

            return res.json({
                success: true,
                duplicate: true,
                message:
                    "This Cozy result was already posted."
            });
        }

        // ------------------------------------------
        // CHECK DISCORD
        // ------------------------------------------

        if (!client.isReady()) {

            console.log(
                "❌ Discord bot is not ready. Data is saved securely in database, but Discord notification is delayed."
            );

            return res.status(202).json({
                success: true,
                queued: true,
                message:
                    "Top Cozy saved to database! Discord client is establishing connection."
            });
        }

        // ------------------------------------------
        // POST
        // ------------------------------------------

        const posted =
            await sendTopCozyMessage(
                username,
                cozyLevel,
                streamDate
            );

        if (!posted) {

            return res.status(500).json({
                success: false,
                message:
                    "Cozy was saved, but Discord posting failed."
            });
        }

        // ------------------------------------------
        // MARK POSTED
        // ------------------------------------------

        await markDiscordPosted(
            recordId
        );

        console.log(
            "✅ Cozy record marked as posted."
        );

        return res.json({
            success: true,
            duplicate: false,
            message:
                "Top Cozy saved and posted to Discord."
        });

    } catch (error) {

        console.error(
            "❌ /cozy ERROR:",
            error
        );

        return res.status(500).json({
            success: false,
            message:
                "Internal Cozy Bot error."
        });
    }
});

// ==================================================
// !MYCOZY
// ==================================================

client.on(
    "messageCreate",
    async (message) => {

        try {

            if (message.author.bot) {
                return;
            }

            if (
                message.content
                    .trim()
                    .toLowerCase() !== "!mycozy"
            ) {
                return;
            }

            const username =
                message.author.username;

            console.log(
                `🧸 !mycozy requested by ${username}`
            );

            const history =
                await getCozyHistory(
                    username
                );

            const winCount =
                await getCozyWinCount(
                    username
                );

            // --------------------------------------
            // NO WINS
            // --------------------------------------

            if (
                !history ||
                history.length === 0
            ) {

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

            // --------------------------------------
            // HISTORY
            // --------------------------------------

            const historyText =
                history
                    .map((record) => {

                        const date =
                            new Date(
                                record.stream_date +
                                "T00:00:00"
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

            // --------------------------------------
            // SEND HISTORY
            // --------------------------------------

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
    }
);

// ==================================================
// START BOT (WITH AGGRESSIVE AUTO-RECONNECT LOOP)
// ==================================================

async function start() {

    try {

        console.log(
            "🧸 Starting Cozy Bot..."
        );

        if (!DISCORD_TOKEN) throw new Error("DISCORD_TOKEN is not configured.");
        if (!TOP_COZY_CHANNEL_ID) throw new Error("TOP_COZY_CHANNEL_ID is not configured.");
        if (!COZY_WEBHOOK_SECRET) throw new Error("COZY_WEBHOOK_SECRET is not configured.");

        console.log("🧸 Initializing database...");
        await initializeDatabase();
        console.log("✅ Database initialized.");

        app.listen(PORT, "0.0.0.0", () => {
            console.log("🧸 Cozy web server running on port " + PORT);
        });

        // Robust connection function with loop retry
        async function connectWithRetry() {
            let attempts = 0;
            while (!client.isReady()) {
                attempts++;
                console.log(`🚀 Discord login attempt #${attempts} starting...`);
                try {
                    await client.login(DISCORD_TOKEN.trim());
                    console.log("🟢 Discord login() succeeded!");
                    break;
                } catch (err) {
                    console.error(`❌ Attempt #${attempts} failed:`, err.message);
                    console.log("🔄 Retrying gateway connection in 10 seconds...");
                    await new Promise(res => setTimeout(res, 10000));
                }
            }
        }

        connectWithRetry();

    } catch (error) {
        console.error("❌ Failed to start Cozy Bot:", error);
        process.exit(1);
    }
}

// ==================================================
// RUN
// ==================================================

start();