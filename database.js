const sqlite3 = require('sqlite3').verbose();
let db = null;

function initializeDatabase() {
    return new Promise((resolve, reject) => {
        db = new sqlite3.Database('./cozy_history.db', (err) => {
            if (err) {
                console.error("❌ Error opening database", err);
                return reject(err);
            }
            console.log("Connected to SQLite database.");
            
            db.run(`CREATE TABLE IF NOT EXISTS cozy_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT,
                cozy_level INTEGER,
                stream_date TEXT
            )`, (createErr) => {
                if (createErr) {
                    return reject(createErr);
                }
                resolve();
            });
        });
    });
}

function saveCozy(username, cozyLevel, streamDate) {
    return new Promise((resolve, reject) => {
        const query = `INSERT INTO cozy_history (username, cozy_level, stream_date) VALUES (?, ?, ?)`;
        db.run(query, [username, cozyLevel, streamDate], function(err) {
            if (err) {
                return reject(err);
            }
            resolve({
                inserted: true,
                row: { id: this.lastID, username, cozy_level: cozyLevel, stream_date: streamDate }
            });
        });
    });
}

module.exports = {
    initializeDatabase,
    saveCozy,
    get db() { return db; }
};