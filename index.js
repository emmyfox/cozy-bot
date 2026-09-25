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

// ======================================================
// DISCORD GATEWAY DIAGNOSTICS
// ======================================================

client.on("debug", function (info) {
    // Do NOT print debug information that may contain the token.
    if (
        info.includes("Provided token:") ||
        info.includes("Authorization:")
    ) {
        console.log("🔎 DISCORD DEBUG: Token information hidden.");
        return;
    }

    console.log("🔎 DISCORD DEBUG:", info);
});

client.on("warn", function (info) {
    console.log("⚠️ DISCORD WARNING:", info);
});

client.on("error", function (error) {
    console.error("❌ DISCORD CLIENT ERROR:", error);
});

client.on("shardError", function (error) {
    console.error("❌ DISCORD SHARD ERROR:", error);
});

client.on("shardReady", function (shardId) {
    console.log(
        "🟢 DISCORD SHARD READY:",
        shardId
    );
});

client.on("shardDisconnect", function (event, shardId) {
    console.log(
        "🔴 DISCORD SHARD DISCONNECTED:",
        shardId,
        event
    );
});

client.on("shardReconnecting", function (shardId) {
    console.log(
        "🟡 DISCORD SHARD RECONNECTING:",
        shardId
    );
});

client.on("invalidated", function () {
    console.error(
        "❌ DISCORD SESSION INVALIDATED."
    );
});


// ======================================================
// ENVIRONMENT VARIABLES
// ======================================================

const TOP_COZY_CHANNEL_ID =
    process.env.TOP_COZY_CHANNEL_ID;

const COZY_WEBHOOK_SECRET =
    process.env.COZY_WEBHOOK_SECRET;

const TIMEZONE =
    process.env.TIMEZONE || "America/New_York";


// ======================================================
// HELPER FUNCTIONS
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
// WEB SERVER
// ======================================================

app.get("/", function (req, res) {
    res.send("🧸 Cozy Bot is awake!");
});


// ======================================================
// COZY WEBHOOK
// ======================================================

app.post("/cozy", async function (req, res) {
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

        console.log(
            "🔐 Received secret length:",
            receivedSecret.length
        );

        console.log(
            "🔐 Render secret length:",
            savedSecret.length
        );

        console.log(
            "🔐 Secret lengths match:",
            receivedSecret.length === savedSecret.length
        );

        if (!savedSecret) {
            console.log(
                "❌ COZY_WEBHOOK_SECRET is empty in Render."
            );

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
            console.log(
                "❌ Missing username."
            );

            return res.status(400).json({
                success: false,
                error: "Missing username"
            });
        }

        if (level === null) {
            console.log(
                "❌ Invalid cozy level."
            );

            return res.status(400).json({
                success: false,
                error: "Invalid cozy level"
            });
        }

        const streamDate =
            getToday();

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
                message:
                    "This Cozy result was already posted today."
            });
        }

        console.log(
            "🧸 Discord channel ID:",
            TOP_COZY_CHANNEL_ID
        );

        if (!TOP_COZY_CHANNEL_ID) {
            throw new Error(
                "TOP_COZY_CHANNEL_ID is not configured."
            );
        }

        if (!client.isReady()) {
            console.log(
                "⚠️ Discord client is NOT ready yet."
            );

            return res.status(503).json({
                success: false,
                error:
                    "Discord bot is not connected yet."
            });
        }

        console.log(
            "✅ Discord client is ready."
        );

        const channel =
            await client.channels.fetch(
                TOP_COZY_CHANNEL_ID
            );

        if (!channel) {
            throw new Error(
                "Top Cozy channel not found."
            );
        }

        console.log(
            "✅ Discord channel found:",
            channel.name
        );

        const displayDate =
            getDisplayDate();

        const description =
            "✨ **" +
            cleanName +
            "** was today's Top Cozy!\n\n" +
            "💜 Cozy Level: **" +
            level +
            "%**\n" +
            "📅 " +
            displayDate +
            "\n\n" +
            "☕ Thank you for being cozy! 💜";

        const embed =
            new EmbedBuilder()
                .setTitle("🧸 TOP COZY!")
                .setDescription(description);

        console.log(
            "🧸 Sending Top Cozy message to Discord..."
        );

        await channel.send({
            embeds: [embed]
        });

        console.log(
            "✅ Top Cozy message sent to Discord!"
        );

        await markDiscordPosted(
            cozyRecord.id
        );

        console.log(
            "🧸 Final Cozy saved and posted: " +
            cleanName +
            " - " +
            level +
            "% - " +
            displayDate
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
// !MYCOZY COMMAND
// ======================================================

client.on(
    "messageCreate",
    async function (message) {

        if (message.author.bot) {
            return;
        }

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

        let username;

        if (parts.length > 1) {
            username =
                cleanUsername(parts[1]);
        } else {
            username =
                message.author.username;
        }

        try {
            const history =
                await getCozyHistory(
                    username
                );

            const winCount =
                await getCozyWinCount(
                    username
                );

            if (history.length === 0) {
                await message.reply(
                    "🧸 **" +
                    username +
                    "**, you don't have any Top Cozy wins yet!\n\n" +
                    "☕ Keep hanging out and being cozy! 💜"
                );

                return;
            }

            const historyText =
                history
                    .map(function (entry) {

                        const date =
                            new Date(
                                entry.stream_date
                            ).toLocaleDateString(
                                "en-US",
                                {
                                    timeZone:
                                        TIMEZONE,
                                    year:
                                        "numeric",
                                    month:
                                        "long",
                                    day:
                                        "numeric"
                                }
                            );

                        return (
                            "📅 **" +
                            date +
                            "** — **" +
                            entry.cozy_level +
                            "%**"
                        );
                    })
                    .join("\n");

            const historyDescription =
                "🏆 **" +
                winCount +
                " Top Cozy " +
                (
                    winCount === 1
                        ? "win"
                        : "wins"
                ) +
                "**\n\n" +
                historyText +
                "\n\n" +
                "☕ Keep being cozy! 💜";

            const embed =
                new EmbedBuilder()
                    .setTitle(
                        "🧸 " +
                        username +
                        "'s Cozy History"
                    )
                    .setDescription(
                        historyDescription
                    );

            await message.reply({
                embeds: [embed]
            });

        } catch (error) {

            console.error(
                "❌ !mycozy error:",
                error
            );

            await message.reply(
                "🧸 Oops! I couldn't retrieve your Cozy history right now."
            );
        }
    }
);


// ======================================================
// DISCORD READY
// ======================================================

client.once(
    "ready",
    function () {

        console.log(
            "🧸 Cozy Bot ONLINE as " +
            client.user.tag
        );

        console.log(
            "🧸 Discord User ID:",
            client.user.id
        );

        console.log(
            "🧸 Connected Discord Guilds:",
            client.guilds.cache.size
        );

        console.log(
            "🟢 DISCORD GATEWAY CONNECTION SUCCESSFUL."
        );
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

        if (!process.env.DISCORD_TOKEN) {

            throw new Error(
                "DISCORD_TOKEN is not configured in Render."
            );
        }

        if (!TOP_COZY_CHANNEL_ID) {

            throw new Error(
                "TOP_COZY_CHANNEL_ID is not configured in Render."
            );
        }

        if (!COZY_WEBHOOK_SECRET) {

            throw new Error(
                "COZY_WEBHOOK_SECRET is not configured in Render."
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
            function () {

                console.log(
                    "🧸 Cozy web server running on port " +
                    PORT
                );
            }
        );

        console.log(
            "🧸 Connecting to Discord..."
        );

        console.log(
            "🧪 Discord token exists:",
            Boolean(
                process.env.DISCORD_TOKEN
            )
        );

        console.log(
            "🧪 Discord token length:",
            String(
                process.env.DISCORD_TOKEN
            ).trim().length
        );

        await client.login(
            process.env.DISCORD_TOKEN
        );

        console.log(
            "🧸 Discord login() returned successfully."
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