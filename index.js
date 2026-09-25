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
        const {
            username,
            cozyLevel,
            secret
        } = req.body;

        const receivedSecret = String(secret || "")
            .replace(/\r/g, "")
            .replace(/\n/g, "")
            .trim();

        const savedSecret = String(COZY_WEBHOOK_SECRET || "")
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
            console.log("❌ Missing username.");

            return res.status(400).json({
                success: false,
                error: "Missing username"
            });
        }

        if (level === null) {
            console.log("❌ Invalid cozy level.");

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

        console.log(
            "🧸 Cozy save result:",
            saveResult.saved
        );

        if (!saveResult.row) {
            throw new Error(
                "Could not save or find Cozy result."
            );
        }

        const cozyRecord = saveResult.row;

        console.log(
            "🧸 Cozy record ID:",
            cozyRecord.id
        );

        console.log(
            "🧸 Discord already posted:",
            cozyRecord.discord_posted
        );

        // --------------------------------------------------
        // DO NOT POST TWICE
        // --------------------------------------------------

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
                "TOP_COZY_CHANNEL_ID is missing from Render environment variables."
            );
        }

        // --------------------------------------------------
        // CHECK DISCORD CONNECTION
        // --------------------------------------------------

        console.log(
            "🔌 Discord client ready state:",
            client.isReady()
        );

        if (!client.isReady()) {
            throw new Error(
                "Discord bot is not connected yet."
            );
        }

        console.log(
            "🔎 Fetching Discord channel..."
        );

        const channel = await client.channels.fetch(
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

        const displayDate = getDisplayDate();

        const embed = new EmbedBuilder()
            .setTitle("🧸 TOP COZY!")
            .setDescription(
                `✨ **${cleanName}** was today's Top Cozy!\n\n` +
                `💜 Cozy Level: **${level}%**\n` +
                `📅 ${displayDate}\n\n` +
                `☕ Thank you for being cozy! 💜`
            );

        console.log(
            "📤 Sending Top Cozy message to Discord..."
        );

        await channel.send({
            embeds: [embed]
        });

        console.log(
            "✅ Discord accepted the Top Cozy message."
        );

        // --------------------------------------------------
        // ONLY MARK POSTED AFTER DISCORD SUCCEEDS
        // --------------------------------------------------

        await markDiscordPosted(cozyRecord.id);

        console.log(
            `🧸 Final Cozy saved and posted: ${cleanName} - ${level}% - ${displayDate}`
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
        console.error("❌ Cozy error:", error);

        return res.status(500).json({
            success: false,
            error: "Server error"
        });
    }
});

// --------------------------------------------------
// !MYCOZY
// --------------------------------------------------

client.on("messageCreate", async (message) => {
    if (message.author.bot) return;

    const content = message.content.trim();

    if (!content.toLowerCase().startsWith("!mycozy")) {
        return;
    }

    const parts = content.split(/\s+/);

    let username;

    if (parts.length > 1) {
        username = cleanUsername(parts[1]);
    } else {
        username = message.author.username;
    }

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
            .setTitle(
                `🧸 ${username}'s Cozy History`
            )
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
        console.error(
            "❌ !mycozy error:",
            error
        );

        await message.reply(
            "🧸 Oops! I couldn't retrieve your Cozy history right now."
        );
    }
});

// --------------------------------------------------
// DISCORD EVENTS
// --------------------------------------------------

client.once("ready", () => {
    console.log(
        `🧸 Cozy Bot online as ${client.user.tag}`
    );

    console.log(
        "🧸 Discord connection is READY!"
    );
});

client.on("error", (error) => {
    console.error(
        "❌ DISCORD CLIENT ERROR:",
        error
    );
});

client.on("shardError", (error) => {
    console.error(
        "❌ DISCORD SHARD ERROR:",
        error
    );
});

client.on("warn", (warning) => {
    console.warn(
        "⚠️ DISCORD WARNING:",
        warning
    );
});

// --------------------------------------------------
// START BOT
// --------------------------------------------------

async function start() {
    try {
        console.log(
            "🧸 Starting Cozy Bot..."
        );

        await initializeDatabase();

        app.listen(PORT, () => {
            console.log(
                `🧸 Cozy web server running on port ${PORT}`
            );
        });

        console.log(
            "🔌 Connecting to Discord..."
        );

        if (!process.env.DISCORD_TOKEN) {
            throw new Error(
                "DISCORD_TOKEN is missing from Render environment variables."
            );
        }

        await client.login(
            process.env.DISCORD_TOKEN
        );

        console.log(
            "🔌 Discord login request completed."
        );

    } catch (error) {
        console.error(
            "❌ DISCORD LOGIN ERROR:",
            error
        );

        process.exit(1);
    }
}

start();
```

**Now just replace the entire `index.js` on GitHub with that.**

Then commit the change and let Render redeploy.

**Don't run Mix It Up yet.** After the deployment, the logs should tell
