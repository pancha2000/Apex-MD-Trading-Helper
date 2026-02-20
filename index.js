/**
 * ╔═══════════════════════════════════════════╗
 * ║   CRYPTO AI TRADING BOT - OPTIMIZED       ║
 * ╚═══════════════════════════════════════════╝
 */

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const express = require('express');
const { File } = require('megajs');
const fs = require('fs');
const path = require('path');

const config = require('./config');
const { connectDB } = require('./lib/database');
const { handler } = require('./lib/commands');

let serialize;
if (fs.existsSync('./lib/functions.js')) {
    serialize = require('./lib/functions').serialize;
} else {
    serialize = require('./lib/function').serialize;
}

require('fs').readdirSync('./plugins/').forEach(plugin => {
    if (path.extname(plugin).toLowerCase() == '.js') {
        require('./plugins/' + plugin);
    }
});

const app = express();
const PORT = process.env.PORT || 8000;

app.get('/', (req, res) => {
    res.send('🚀 Crypto AI Bot is Running Successfully!');
});

app.listen(PORT, () => {
    console.log(`🌐 Web Server running on port ${PORT}`);
});

async function downloadSession() {
    if (!fs.existsSync(path.join(__dirname, 'auth_info', 'creds.json')) && config.SESSION_ID) {
        console.log('📥 Downloading NEW Session from Mega...');
        try {
            const file = File.fromURL(`https://mega.nz/file/${config.SESSION_ID}`);
            const data = await file.downloadBuffer();
            
            if (!fs.existsSync(path.join(__dirname, 'auth_info'))) {
                fs.mkdirSync(path.join(__dirname, 'auth_info'));
            }
            
            fs.writeFileSync(path.join(__dirname, 'auth_info', 'creds.json'), data);
            console.log('✅ Session Downloaded Successfully!');
        } catch (e) {
            console.error('❌ Error downloading session:', e.message);
        }
    }
}

async function startBot() {
    await downloadSession();

    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`🔄 Using WA v${version.join('.')}, isLatest: ${isLatest}`);

    const conn = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ['Ubuntu', 'Chrome', '20.0.04'], // වඩාත් ආරක්ෂිත Browser Signature එකක්
        auth: state,
        getMessage: async (key) => {
            return { conversation: 'Apex Crypto Bot' };
        }
    });

    conn.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            let reason = lastDisconnect.error?.output?.statusCode;
            console.log(`⚠️ Connection Closed. Reason: ${reason}`);
            
            // 440 හෝ 401 ආවොත් Session එක Delete කරලා බොට්ව නවත්වනවා
            if (reason === DisconnectReason.loggedOut || reason === 440 || reason === 401) {
                console.log('❌ Session Invalid or Logged out! Please delete auth_info, get a NEW SESSION_ID and restart.');
                if (fs.existsSync('./auth_info')) {
                    fs.rmSync('./auth_info', { recursive: true, force: true });
                }
                process.exit(1);
            } else {
                console.log('🔄 Reconnecting in 3 seconds...');
                setTimeout(startBot, 3000);
            }
        } else if (connection === 'open') {
            console.log('✅ Bot Connected to WhatsApp Successfully!');
        }
    });

    conn.ev.on('creds.update', saveCreds);

    conn.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message) return;

        try {
            let mek;
            try { mek = await serialize(msg, conn); } catch(e) {}
            if (!mek) { try { mek = await serialize(conn, msg); } catch(e) {} }
            if (!mek) return;

            const body = mek.body || '';
            const prefix = config.PREFIX || '.';
            const isCmd = body.startsWith(prefix);
            const command = isCmd ? body.slice(prefix.length).trim().split(' ').shift().toLowerCase() : '';
            const args = body.trim().split(/ +/).slice(1);
            const text = args.join(' ');
            const from = mek.from;

            mek.react = async (emoji) => {
                try { await conn.sendMessage(from, { react: { text: emoji, key: msg.key } }); } catch(e) {}
            };

            if (isCmd) {
                console.log(`\n💬 Command Received: ${command}`);
                const cmd = handler.findCommand(command);
                if (cmd) {
                    if (cmd.isOwner && !config.isOwner(mek.sender)) {
                        return await conn.sendMessage(from, { text: '❌ This command is for the owner only.' }, { quoted: msg });
                    }

                    await cmd.function(conn, mek, mek, {
                        reply: async (text) => await conn.sendMessage(from, { text: text }, { quoted: msg }),
                        text, args, body, command, from, q: text
                    });
                    console.log(`✅ Command '${command}' Executed!`);
                }
            }
        } catch (e) {
            console.error('❌ Message Error:', e);
        }
    });
}

if (config.MONGODB) {
    connectDB().catch(err => console.error("DB Error:", err));
}
startBot();
/**
 * ╔═══════════════════════════════════════════╗
 * ║   CRYPTO AI TRADING BOT - OPTIMIZED       ║
 * ╚═══════════════════════════════════════════╝
 */

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const express = require('express');
const { File } = require('megajs');
const fs = require('fs');
const path = require('path');

const config = require('./config');
const { connectDB } = require('./lib/database');
const { handler } = require('./lib/commands');

let serialize;
if (fs.existsSync('./lib/functions.js')) {
    serialize = require('./lib/functions').serialize;
} else {
    serialize = require('./lib/function').serialize;
}

require('fs').readdirSync('./plugins/').forEach(plugin => {
    if (path.extname(plugin).toLowerCase() == '.js') {
        require('./plugins/' + plugin);
    }
});

const app = express();
const PORT = process.env.PORT || 8000;

app.get('/', (req, res) => {
    res.send('🚀 Crypto AI Bot is Running Successfully!');
});

app.listen(PORT, () => {
    console.log(`🌐 Web Server running on port ${PORT}`);
});

async function downloadSession() {
    if (!fs.existsSync(path.join(__dirname, 'auth_info', 'creds.json')) && config.SESSION_ID) {
        console.log('📥 Downloading NEW Session from Mega...');
        try {
            const file = File.fromURL(`https://mega.nz/file/${config.SESSION_ID}`);
            const data = await file.downloadBuffer();
            
            if (!fs.existsSync(path.join(__dirname, 'auth_info'))) {
                fs.mkdirSync(path.join(__dirname, 'auth_info'));
            }
            
            fs.writeFileSync(path.join(__dirname, 'auth_info', 'creds.json'), data);
            console.log('✅ Session Downloaded Successfully!');
        } catch (e) {
            console.error('❌ Error downloading session:', e.message);
        }
    }
}

async function startBot() {
    await downloadSession();

    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`🔄 Using WA v${version.join('.')}, isLatest: ${isLatest}`);

    const conn = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ['Ubuntu', 'Chrome', '20.0.04'], // වඩාත් ආරක්ෂිත Browser Signature එකක්
        auth: state,
        getMessage: async (key) => {
            return { conversation: 'Apex Crypto Bot' };
        }
    });

    conn.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            let reason = lastDisconnect.error?.output?.statusCode;
            console.log(`⚠️ Connection Closed. Reason: ${reason}`);
            
            // 440 හෝ 401 ආවොත් Session එක Delete කරලා බොට්ව නවත්වනවා
            if (reason === DisconnectReason.loggedOut || reason === 440 || reason === 401) {
                console.log('❌ Session Invalid or Logged out! Please delete auth_info, get a NEW SESSION_ID and restart.');
                if (fs.existsSync('./auth_info')) {
                    fs.rmSync('./auth_info', { recursive: true, force: true });
                }
                process.exit(1);
            } else {
                console.log('🔄 Reconnecting in 3 seconds...');
                setTimeout(startBot, 3000);
            }
        } else if (connection === 'open') {
            console.log('✅ Bot Connected to WhatsApp Successfully!');
        }
    });

    conn.ev.on('creds.update', saveCreds);

    conn.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message) return;

        try {
            let mek;
            try { mek = await serialize(msg, conn); } catch(e) {}
            if (!mek) { try { mek = await serialize(conn, msg); } catch(e) {} }
            if (!mek) return;

            const body = mek.body || '';
            const prefix = config.PREFIX || '.';
            const isCmd = body.startsWith(prefix);
            const command = isCmd ? body.slice(prefix.length).trim().split(' ').shift().toLowerCase() : '';
            const args = body.trim().split(/ +/).slice(1);
            const text = args.join(' ');
            const from = mek.from;

            mek.react = async (emoji) => {
                try { await conn.sendMessage(from, { react: { text: emoji, key: msg.key } }); } catch(e) {}
            };

            if (isCmd) {
                console.log(`\n💬 Command Received: ${command}`);
                const cmd = handler.findCommand(command);
                if (cmd) {
                    if (cmd.isOwner && !config.isOwner(mek.sender)) {
                        return await conn.sendMessage(from, { text: '❌ This command is for the owner only.' }, { quoted: msg });
                    }

                    await cmd.function(conn, mek, mek, {
                        reply: async (text) => await conn.sendMessage(from, { text: text }, { quoted: msg }),
                        text, args, body, command, from, q: text
                    });
                    console.log(`✅ Command '${command}' Executed!`);
                }
            }
        } catch (e) {
            console.error('❌ Message Error:', e);
        }
    });
}

if (config.MONGODB) {
    connectDB().catch(err => console.error("DB Error:", err));
}
startBot();

