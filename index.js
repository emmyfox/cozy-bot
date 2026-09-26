require('dotenv').config();
const express = require('express');
const { initializeDatabase, saveCozy, db } = require('./database');

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

app.get('/cozy/history/:username', async (req, res) => {
    try {
        let username = req.params.username;
        
        if (!username) {
            username = 'mcdemil';
        } else {
            username = username.toLowerCase();
        }
        
        if (username === '$user') {
            username = 'mcdemil';
        }
        
        if (username.indexOf('$') !== -1) {
            username = 'mcdemil';
        }
        
        if (!db) {
            console.error("❌ Database connection not initialized.");
            return res.send(`✨ @${username}, database connection is starting up, try again in a moment!`);
        }
        
        db.all(
            "SELECT stream_date, cozy_level FROM cozy_history WHERE LOWER(username) = ? ORDER BY stream_date DESC",
            [username],
            (err, rows) => {
                if (err) {
                    console.error("❌ DB Query Error:", err);
                    return res.send(`✨ @${username}, you don't have any Top Cozy wins recorded yet!`);
                }

                if (!rows || rows.length === 0) {
                    return res.send(`✨ @${username}, you don't have any Top Cozy wins recorded yet!`);
                }

                let responseText = `🧸 Top Cozy History for @${username}:\n`;
                rows.forEach(row => {
                    responseText += `• 📅 ${row.stream_date} — Cozy Level: ${row.cozy_level}%\n`;
                });

                res.send(responseText.trim());
            }
        );
    } catch (err) {
        console.error("❌ Error in history endpoint:", err);
        res.send(`✨ @mcdemil, you don't have any Top Cozy wins recorded yet!`);
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