require('dotenv').config();
const express = require('express');
const { initializeDatabase, saveCozy } = require('./database');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "98hasbdjmsnmcde";

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