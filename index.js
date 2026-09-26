require("dotenv").config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

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
    db.run(`CREATE TABLE IF NOT EXISTS cozy_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        content TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS daily_cozy (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        winner_name TEXT,
        score TEXT,
        date TEXT UNIQUE
    )`);
}

// --- DATABASE HELPER FUNCTIONS ---
function saveCozy(userId, content, callback) {
    db.run(`INSERT INTO cozy_history (user_id, content) VALUES (?, ?)`, [userId, content], function(err) {
        if (callback) callback(err, this ? this.lastID : null);
    });
}

function getCozyHistory(userId, callback) {
    db.all(`SELECT content, timestamp FROM cozy_history WHERE user_id = ? ORDER BY timestamp DESC LIMIT 5`, [userId], (err, rows) => {
        callback(err, rows);
    });
}

function saveDailyWinner(winnerName, score, callback) {
    const today = new Date().toISOString().split('T')[0];
    db.run(`INSERT OR REPLACE INTO daily_cozy (winner_name, score, date) VALUES (?, ?, ?)`, [winnerName, score, today], function(err) {
        if (callback) callback(err, today);
    });
}

function getDailyWinner(callback) {
    const today = new Date().toISOString().split('T')[0];
    db.get(`SELECT winner_name, score FROM daily_cozy WHERE date = ?`, [today], (err, row) => {
        callback(err, row);
    });
}

// --- WEBHOOK ROUTES FOR MIX IT UP & DISCORD ---

// 1. Save a cozy moment (called by Mix It Up or custom action)
app.post('/cozy', (req, res) => {
    const { userId, content } = req.body;
    if (!userId || !content) {
        return res.status(400).json({ error: 'Missing userId or content' });
    }

    saveCozy(userId, content, (err, id) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ success: true, id });
    });
});

// 2. Save today's top cozy winner (triggered by Mix It Up at stream end)
app.post('/top-cozy', (req, res) => {
    const { winnerName, score } = req.body;
    if (!winnerName) {
        return res.status(400).json({ error: 'Missing winnerName' });
    }

    saveDailyWinner(winnerName, score || 'N/A', (err, date) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ success: true, date, winnerName });
    });
});

// 3. Get today's top cozy winner (for Discord or Mix It Up lookups)
app.get('/top-cozy', (req, res) => {
    getDailyWinner((err, row) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (!row) {
            return res.json({ winner: 'No top cozy winner recorded for today yet!' });
        }
        res.json({ success: true, winner: row.winner_name, score: row.score });
    });
});

app.get('/', (req, res) => {
    res.send('Cozy Bot Webhook API is alive and running!');
});

// --- START SERVER ---
app.listen(PORT, () => {
    console.log(`🧸 Cozy web server running on port ${PORT}`);
});