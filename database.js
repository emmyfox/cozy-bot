const { Pool } = require("pg");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL
        ? { rejectUnauthorized: false }
        : false
});

async function initializeDatabase() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS cozy_history (
            id SERIAL PRIMARY KEY,
            username TEXT NOT NULL,
            cozy_level INTEGER NOT NULL,
            stream_date DATE NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE(username, stream_date)
        )
    `);

    console.log("🧸 Cozy database ready!");
}

async function saveCozy(username, cozyLevel, streamDate) {
    const result = await pool.query(
        `
        INSERT INTO cozy_history
        (username, cozy_level, stream_date)
        VALUES ($1, $2, $3)
        ON CONFLICT (username, stream_date)
        DO NOTHING
        RETURNING id
        `,
        [username, cozyLevel, streamDate]
    );

    return result.rowCount > 0;
}

async function getCozyHistory(username) {
    const result = await pool.query(
        `
        SELECT username, cozy_level, stream_date
        FROM cozy_history
        WHERE LOWER(username) = LOWER($1)
        ORDER BY stream_date DESC
        `,
        [username]
    );

    return result.rows;
}

async function getCozyWinCount(username) {
    const result = await pool.query(
        `
        SELECT COUNT(*)::INTEGER AS count
        FROM cozy_history
        WHERE LOWER(username) = LOWER($1)
        `,
        [username]
    );

    return result.rows[0].count;
}

module.exports = {
    pool,
    initializeDatabase,
    saveCozy,
    getCozyHistory,
    getCozyWinCount
};