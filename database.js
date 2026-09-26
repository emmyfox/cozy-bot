const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'cozy.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('❌ Error opening database', err.message);
    } else {
        console.log('connected to the SQLite database.');
    }
});

function initializeDatabase() {
    return new Promise((resolve, reject) => {
        const query = `
            CREATE TABLE IF NOT EXISTS cozy_wins (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL,
                cozy_level INTEGER NOT NULL,
                stream_date TEXT NOT NULL,
                discord_posted INTEGER DEFAULT 0
            )
        `;
        db.run(query, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

function saveCozy(username, cozyLevel, streamDate) {
    return new Promise((resolve, reject) => {
        const checkQuery = `SELECT * FROM cozy_wins WHERE username = ? AND stream_date = ?`;
        db.get(checkQuery, [username, streamDate], (err, row) => {
            if (err) return reject(err);
            if (row) {
                return resolve({ row, inserted: false });
            }

            const insertQuery = `INSERT INTO cozy_wins (username, cozy_level, stream_date, discord_posted) VALUES (?, ?, ?, 0)`;
            db.run(insertQuery, [username, cozyLevel, streamDate], function(err) {
                if (err) return reject(err);
                const newRow = {
                    id: this.lastID,
                    username,
                    cozy_level: cozyLevel,
                    stream_date: streamDate,
                    discord_posted: 0
                };
                resolve({ row: newRow, inserted: true });
            });
        });
    });
}

function markDiscordPosted(id) {
    return new Promise((resolve, reject) => {
        const query = `UPDATE cozy_wins SET discord_posted = 1 WHERE id = ?`;
        db.run(query, [id], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

function getCozyHistory(username) {
    return new Promise((resolve, reject) => {
        const query = `SELECT stream_date, cozy_level FROM cozy_wins WHERE username = ? ORDER BY stream_date DESC LIMIT 5`;
        db.all(query, [username], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function getCozyWinCount(username) {
    return new Promise((resolve, reject) => {
        const query = `SELECT COUNT(*) as count FROM cozy_wins WHERE username = ?`;
        db.get(query, [username], (err, row) => {
            if (err) reject(err);
            else resolve(row ? row.count : 0);
        });
    });
}

module.exports = {
    initializeDatabase,
    saveCozy,
    markDiscordPosted,
    getCozyHistory,
    getCozyWinCount
};