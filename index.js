require("dotenv").config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const https = require('https');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

// Discord Channel Webhook URL from your Render Environment Variables
const DISCORD_CHANNEL_WEBHOOK = process.env.DISCORD_CHANNEL_WEBHOOK || "";

// --- DATABASE SETUP ---
const db = new sqlite3.Database('./cozy.db', (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        initializeDatabase();
    }
});

function initializeDatabase() {
    db.run(`CREATE TABLE IF NOT EXISTS daily_cozy (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT,
        cozy_level TEXT,
        date TEXT UNIQUE
    )`);
}

function saveDailyWinner(username, cozyLevel, callback) {
    const today = new Date().toISOString().split('T')[0];
    db.run(`INSERT OR REPLACE INTO daily_cozy (username, cozy_level, date) VALUES (?, ?, ?)`, [username, cozyLevel, today], function(err) {
        if (callback) callback(err, today);
    });
}

function getUserHistory(username, callback) {
    db.all(`SELECT cozy_level, date FROM daily_cozy WHERE username = ? ORDER BY date DESC LIMIT 5`, [username], (err, rows) => {
        callback(err, rows);
    });
}

// --- SEND MESSAGE TO DISCORD WEBHOOK ---
function postToDiscord(messageText) {
    if (!DISCORD_CHANNEL_WEBHOOK) return;
    
    const data = JSON.stringify({ content: messageText });
    const url = new URL(DISCORD_CHANNEL_WEBHOOK);

    const options = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': data.length
        }
    };

    const req = https.request(options, (res) => {
        res.on('data', () => {});
    });

    req.on('error', (error) => {
        console.error('Error posting to Discord webhook:', error);
    });

    req.write(data);
    req.end();
}

// --- WEBHOOK ROUTES (Listening on /cozy to match your Mix It Up setup) ---
app.post('/cozy', (req, res) => {
    const { username, cozyLevel, secret } = req.body;
    
    if (secret !== "98hasbdjmsnmcde") {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!username) {
        return res.status(400).json({ error: 'Missing username' });
    }

    const levelText = cozyLevel || 'N/A';

    saveDailyWinner(username, levelText, (err, date) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        // Automatically post to your Discord channel when stream ends!
        const discordMessage = `🏆 **Stream Ended!** Today's Top Cozy Winner is **${username}** with a Cozy Level of **${levelText}**! ✨`;
        postToDiscord(discordMessage);

        res.json({ success: true, date, username, cozyLevel: levelText });
    });
});

app.get('/mycozy/:username', (req, res) => {
    const username = req.params.username;
    getUserHistory(username, (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (!rows || rows.length === 0) {
            return res.json({ success: true, message: `No top cozy records found for ${username} yet!` });
        }
        res.json({ success: true, history: rows });
    });
});

app.get('/', (req, res) => {
    res.send('Cozy Bot Webhook API is alive and running!');
});

// --- START SERVER & KEEP-ALIVE ---
app.listen(PORT, () => {
    console.log(`🧸 Cozy web server running on port ${PORT}`);

    // Self-ping loop every 14 minutes to keep Render awake
    setInterval(() => {
        https.get('https://cozy-bot-e1zc.onrender.com', (res) => {
            console.log(`Keep-alive ping sent, status: ${res.statusCode}`);
        }).on('error', (err) => {
            console.error('Keep-alive ping failed:', err.message);
        });
    }, 14 * 60 * 1000);
});