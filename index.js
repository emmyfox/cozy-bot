require("dotenv").config();

const express = require("express");
const WebSocket = require("ws");

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

const TOP_COZY_CHANNEL_ID =
process.env.TOP_COZY_CHANNEL_ID;

const COZY_WEBHOOK_SECRET =
process.env.COZY_WEBHOOK_SECRET;

const TIMEZONE =
process.env.TIMEZONE || "America/New_York";

const DISCORD_TOKEN =
process.env.DISCORD_TOKEN;

let discordSocket = null;
let discordReady = false;
let heartbeatTimer = null;
let heartbeatInterval = null;
let sequenceNumber = null;
let reconnectTimer = null;
let reconnectAttempts = 0;

// ======================================================
// HELPERS
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
// DISCORD API
// ======================================================

async function discordRequest(path, options = {}) {


const response = await fetch(
    "https://discord.com/api/v10" + path,
    {
        ...options,
        headers: {
            Authorization:
                "Bot " + DISCORD_TOKEN,

            "Content-Type":
                "application/json",

            ...(options.headers || {})
        }
    }
);

if (!response.ok) {

    const text =
        await response.text();

    throw new Error(
        "Discord API " +
        response.status +
        ": " +
        text.substring(0, 500)
    );
}

if (response.status === 204) {
    return null;
}

return response.json();


}

// ======================================================
// SEND DISCORD MESSAGE
// ======================================================

async function sendTopCozyMessage(
username,
level,
displayDate
) {


const description =
    "✨ **" +
    username +
    "** was today's Top Cozy!\n\n" +
    "💜 Cozy Level: **" +
    level +
    "%**\n" +
    "📅 " +
    displayDate +
    "\n\n" +
    "☕ Thank you for being cozy! 💜";

await discordRequest(
    "/channels/" +
    TOP_COZY_CHANNEL_ID +
    "/messages",
    {
        method: "POST",

        body: JSON.stringify({
            embeds: [
                {
                    title: "🧸 TOP COZY!",
                    description: description
                }
            ]
        })
    }
);


}

// ======================================================
// DISCORD GATEWAY
// ======================================================

function stopHeartbeat() {


if (heartbeatTimer) {
    clearTimeout(heartbeatTimer);
    heartbeatTimer = null;
}

if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
}


}

function sendHeartbeat() {


if (
    !discordSocket ||
    discordSocket.readyState !== WebSocket.OPEN
) {
    return;
}

discordSocket.send(
    JSON.stringify({
        op: 1,
        d: sequenceNumber
    })
);


}

function startHeartbeat(interval) {


stopHeartbeat();

heartbeatInterval =
    setInterval(
        sendHeartbeat,
        interval
    );

sendHeartbeat();


}

function identifyDiscord() {


if (
    !discordSocket ||
    discordSocket.readyState !== WebSocket.OPEN
) {
    return;
}

console.log(
    "🔐 Sending Discord Gateway IDENTIFY..."
);

discordSocket.send(
    JSON.stringify({
        op: 2,

        d: {
            token: DISCORD_TOKEN,

            intents:
                (1 << 0) |
                (1 << 9) |
                (1 << 15),

            properties: {
                os: "linux",
                browser: "cozy-bot",
                device: "cozy-bot"
            }
        }
    })
);


}

function scheduleReconnect() {


if (reconnectTimer) {
    return;
}

reconnectAttempts++;

const delay =
    Math.min(
        30000,
        2000 *
        Math.pow(
            2,
            Math.min(
                reconnectAttempts - 1,
                4
            )
        )
    );

console.log(
    "🟡 Discord reconnect scheduled in " +
    delay +
    "ms"
);

reconnectTimer =
    setTimeout(
        function () {

            reconnectTimer = null;

            connectDiscordGateway();

        },
        delay
    );


}

function connectDiscordGateway() {


if (
    discordSocket &&
    (
        discordSocket.readyState ===
            WebSocket.OPEN ||
        discordSocket.readyState ===
            WebSocket.CONNECTING
    )
) {
    return;
}

console.log(
    "🚀 Connecting directly to Discord Gateway..."
);

discordReady = false;

discordSocket =
    new WebSocket(
        "wss://gateway.discord.gg/?v=10&encoding=json"
    );

discordSocket.on(
    "open",
    function () {

        console.log(
            "🟢 DISCORD GATEWAY WEBSOCKET OPEN."
        );

        reconnectAttempts = 0;
    }
);

discordSocket.on(
    "message",
    function (data) {

        try {

            const packet =
                JSON.parse(
                    data.toString()
                );

            if (
                packet.s !== null &&
                packet.s !== undefined
            ) {
                sequenceNumber =
                    packet.s;
            }

            console.log(
                "🔎 Discord Gateway OP:",
                packet.op
            );

            if (packet.op === 10) {

                console.log(
                    "🟢 DISCORD GATEWAY HELLO RECEIVED."
                );

                startHeartbeat(
                    packet.d.heartbeat_interval
                );

                identifyDiscord();

                return;
            }

            if (packet.op === 0) {

                if (
                    packet.t ===
                    "READY"
                ) {

                    discordReady = true;

                    console.log(
                        "🟢 DISCORD GATEWAY READY."
                    );

                    console.log(
                        "🧸 Cozy Bot ONLINE as " +
                        (
                            packet.d.user.username +
                            "#" +
                            packet.d.user.discriminator
                        )
                    );

                    console.log(
                        "🧸 Discord User ID:",
                        packet.d.user.id
                    );

                    console.log(
                        "🟢 DISCORD GATEWAY CONNECTION SUCCESSFUL."
                    );

                    return;
                }
            }

            if (packet.op === 11) {

                console.log(
                    "💓 Discord Gateway heartbeat acknowledged."
                );

                return;
            }

            if (packet.op === 7) {

                console.log(
                    "🔄 Discord requested reconnect."
                );

                if (discordSocket) {
                    discordSocket.close();
                }

                return;
            }

            if (packet.op === 9) {

                console.error(
                    "❌ Discord Gateway invalid session."
                );

                discordReady = false;

                if (discordSocket) {
                    discordSocket.close();
                }

                return;
            }

        } catch (error) {

            console.error(
                "❌ Discord Gateway message error:",
                error
            );
        }
    }
);

discordSocket.on(
    "error",
    function (error) {

        console.error(
            "❌ DISCORD GATEWAY WEBSOCKET ERROR:",
            error.message
        );
    }
);

discordSocket.on(
    "close",
    function (
        code,
        reason
    ) {

        console.log(
            "🔴 DISCORD GATEWAY CLOSED:",
            code,
            reason
                ? reason.toString()
                : ""
        );

        discordReady = false;

        stopHeartbeat();

        scheduleReconnect();
    }
);


}

// ======================================================
// WEB SERVER
// ======================================================

app.get(
"/",
function (req, res) {


    res.send(
        "🧸 Cozy Bot is awake!"
    );
}


);

// ======================================================
// COZY WEBHOOK
// ======================================================

app.post(
"/cozy",
async function (req, res) {


    console.log(
        "🧸 COZY POST RECEIVED:",
        {
            username:
                req.body.username,

            cozyLevel:
                req.body.cozyLevel,

            secret:
                "[hidden]"
        }
    );

    try {

        const username =
            req.body.username;

        const cozyLevel =
            req.body.cozyLevel;

        const secret =
            req.body.secret;

        const receivedSecret =
            String(secret || "")
                .replace(/\r/g, "")
                .replace(/\n/g, "")
                .trim();

        const savedSecret =
            String(
                COZY_WEBHOOK_SECRET || ""
            )
                .replace(/\r/g, "")
                .replace(/\n/g, "")
                .trim();

        if (!savedSecret) {

            return res.status(500).json({
                success: false,
                error:
                    "Server secret is not configured"
            });
        }

        if (
            receivedSecret !==
            savedSecret
        ) {

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
            validCozyLevel(
                cozyLevel
            );

        if (!cleanName) {

            return res.status(400).json({
                success: false,
                error:
                    "Missing username"
            });
        }

        if (level === null) {

            return res.status(400).json({
                success: false,
                error:
                    "Invalid cozy level"
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

        if (
            cozyRecord.discord_posted
        ) {

            return res.json({
                success: true,
                duplicate: true,
                alreadyPosted: true,
                username:
                    cozyRecord.username,
                cozyLevel:
                    cozyRecord.cozy_level,
                message:
                    "This Cozy result was already posted today."
            });
        }

        if (!discordReady) {

            console.log(
                "⚠️ Discord Gateway is not ready."
            );

            return res.status(503).json({
                success: false,
                error:
                    "Discord bot is not connected yet."
            });
        }

        const displayDate =
            getDisplayDate();

        console.log(
            "🧸 Sending Top Cozy message..."
        );

        await sendTopCozyMessage(
            cleanName,
            level,
            displayDate
        );

        console.log(
            "✅ Top Cozy message sent to Discord!"
        );

        await markDiscordPosted(
            cozyRecord.id
        );

        return res.json({
            success: true,
            duplicate:
                !saveResult.saved,
            alreadyPosted: false,
            username:
                cleanName,
            cozyLevel:
                level,
            date:
                displayDate
        });

    } catch (error) {

        console.error(
            "❌ Cozy error:",
            error
        );

        return res.status(500).json({
            success: false,
            error:
                "Server error"
        });
    }
}


);

// ======================================================
// !MYCOZY
// ======================================================

async function handleMyCozy(
message
) {


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

const username =
    parts.length > 1
        ? cleanUsername(parts[1])
        : message.author.username;

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
            .map(
                function (entry) {

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
                }
            )
            .join("\n");

    const text =
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

    await sendDiscordMessageToChannel(
        message.channelId,
        {
            embeds: [
                {
                    title:
                        "🧸 " +
                        username +
                        "'s Cozy History",

                    description:
                        text
                }
            ]
        }
    );

} catch (error) {

    console.error(
        "❌ !mycozy error:",
        error
    );
}


}

async function sendDiscordMessageToChannel(
channelId,
body
) {


await discordRequest(
    "/channels/" +
    channelId +
    "/messages",
    {
        method: "POST",
        body:
            JSON.stringify(body)
    }
);


}

// ======================================================
// START
// ======================================================

async function start() {


try {

    console.log(
        "🧸 Starting Cozy Bot..."
    );

    if (!DISCORD_TOKEN) {
        throw new Error(
            "DISCORD_TOKEN is not configured."
        );
    }

    if (!TOP_COZY_CHANNEL_ID) {
        throw new Error(
            "TOP_COZY_CHANNEL_ID is not configured."
        );
    }

    if (!COZY_WEBHOOK_SECRET) {
        throw new Error(
            "COZY_WEBHOOK_SECRET is not configured."
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
        "0.0.0.0",
        function () {

            console.log(
                "🧸 Cozy web server running on port " +
                PORT
            );
        }
    );

    console.log(
        "🧪 Discord token exists:",
        Boolean(DISCORD_TOKEN)
    );

    console.log(
        "🧪 Discord token length:",
        DISCORD_TOKEN.trim().length
    );

    console.log(
        "🔐 Testing Discord API authentication..."
    );

    const botUser =
        await discordRequest(
            "/users/@me"
        );

    console.log(
        "✅ Discord token accepted."
    );

    console.log(
        "🧸 Discord bot user ID:",
        botUser.id
    );

    console.log(
        "🚀 Starting direct Discord Gateway..."
    );

    connectDiscordGateway();

} catch (error) {

    console.error(
        "❌ Failed to start Cozy Bot:",
        error
    );

    process.exit(1);
}


}

start();
