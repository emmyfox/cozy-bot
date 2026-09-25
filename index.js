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

// ==================================================
// EXPRESS WEB SERVER
// ==================================================

const app = express();

app.use(express.json());

app.get("/", (req, res) => {
    res.send("🧸 Cozy Bot is alive!");
});

// ==================================================
// SEND TOP COZY MESSAGE TO DISCORD
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
        // TODAY'S DATE
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
        // DON'T POST THE SAME RESULT TWICE
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
        // CHECK DISCORD CONNECTION
        // ------------------------------------------

        if (!client.isReady()) {

            console.log(
                "❌ Discord bot is not ready."
            );

            return res.status(503).json({
                success: false,
                message:
                    "Cozy Bot is not connected to Discord yet."
            });
        }

        // ------------------------------------------
        // POST TO DISCORD
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
        // MARK AS POSTED
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

            // Ignore bots
            if (message.author.bot) {
                return;
            }

            // Only respond to !mycozy
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

            // --------------------------------------
            // GET HISTORY
            // --------------------------------------

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
            // BUILD HISTORY
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
// START BOT
// ==================================================

async function start() {

    try {

        console.log(
            "🧸 Starting Cozy Bot..."
        );

        // ------------------------------------------
        // CHECK REQUIRED ENVIRONMENT VARIABLES
        // ------------------------------------------

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

        // ------------------------------------------
        // DATABASE
        // ------------------------------------------

        console.log(
            "🧸 Initializing database..."
        );

        await initializeDatabase();

        console.log(
            "✅ Database initialized."
        );

        // ------------------------------------------
        // RENDER WEB SERVER
        // ------------------------------------------

        app.listen(
            PORT,
            "0.0.0.0",
            () => {

                console.log(
                    "🧸 Cozy web server running on port " +
                    PORT
                );

            }
        );

        // ------------------------------------------
        // DISCORD LOGIN
        // ------------------------------------------

        console.log(
            "🚀 Connecting Cozy Bot to Discord..."
        );

        console.log(
            "🧪 Discord token exists:",
            Boolean(DISCORD_TOKEN)
        );

        console.log(
            "🧪 Discord token length:",
            DISCORD_TOKEN.trim().length
        );

        client.login(
            DISCORD_TOKEN
        )
        .then(() => {

            console.log(
                "🟢 Discord login() completed."
            );

        })
        .catch((error) => {

            console.error(
                "❌ Discord login() failed:",
                error
            );

        });

        console.log(
            "🔵 Discord login() was called."
        );

    } catch (error) {

        console.error(
            "❌ Failed to start Cozy Bot:",
            error
        );

        process.exit(1);
    }
}

// ==================================================
// RUN
// ==================================================

start();