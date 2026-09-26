require('dotenv').config();
const express = require('express');
const { initializeDatabase, saveCozy, markDiscordPosted } = require('./database');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "98hasbdjmsnmcde";

// Send Top Cozy via Discord Webhook URL (bypasses Cloudflare limits)
async function sendDiscordWebhookMessage(username, cozyLevel, streamDate) {
    try {
        if (!DISCORD_WEBHOOK_URL) {
            console.error("❌ DISCORD_WEBHOOK_URL environment variable is missing!");
            return false;
        }

        const date = new Date(streamDate + "T00:00:00");
        const formattedDate = date.toLocaleDateString("en-US", {
            month: "long",
            day: "numeric",
            year: "numeric"
        });

        const payload = {
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
        };

        const response = await fetch(DISCORD_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Discord webhook responded with status ${response.status}: ${errText}`);
        }

        console.log("✅ Top Cozy message posted to Discord via Webhook.");
        return true;
    } catch (error) {
        console.error("❌ Failed to post Discord message:", error);
        return false;
    }
}

// Webhook endpoint for stream automations
app.post('/cozy', async (req, res) => {
    try {
        console.log("🧸 COZY POST RECEIVED:", req.body);
        const { username, cozyLevel, secret } = req.body;

        if (secret !== WEBHOOK_SECRET) {
            return res.status(403).json({ success: false, message: "Unauthorized webhook secret." });
        }

        const parsedCozyLevel = Number(cozyLevel);
        if (isNaN(parsedCozyLevel)) {
            return res.status(400).json({ success: false, message: "Cozy level must be a number." });
        }

        const streamDate = new Date().toISOString().split('T')[0];
        const { row, inserted } = await saveCozy(username, parsedCozyLevel, streamDate);
        console.log("📊 DB Result -> Inserted:", inserted, "| Row:", row);

        if (row && row.discord_posted === 0) {
            console.log("📤 Attempting to post to Discord via Webhook...");
            const posted = await sendDiscordWebhookMessage(username, parsedCozyLevel, streamDate);
            if (posted) {
                await markDiscordPosted(row.id);
            }
        } else {
            console.log("⏩ Skipping Discord post: Already marked as posted for today.");
        }

        res.json({ success: true, message: "Cozy win recorded successfully.", data: row });
    } catch (err) {
        console.error("❌ Error handling cozy webhook:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/', (req, res) => {
    res.send('🧸 Cozy Bot webhook server is running!');
});

async function startBot() {
    console.log("🧸 Starting Cozy Bot...");
    console.log("🧸 Initializing database...");
    await initializeDatabase();
    console.log("✅ Database initialized.");

    app.listen(PORT, () => {
        console.log(`🧸 Cozy web server running on port ${PORT}`);
    });
}

startBot().catch(err => {
    console.log("❌ Fatal error starting bot:", err);
});