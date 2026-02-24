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
const { startScanner } = require('./lib/scanner');

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
    if (fs.existsSync(path.join(__dirname, 'auth_info'))) {
        console.log('🗑️ Clearing old session files...');
        fs.rmSync(path.join(__dirname, 'auth_info'), { recursive: true, force: true });
    }

    if (config.SESSION_ID) {
        console.log('📥 Downloading Fresh Session from Mega...');
        try {
            const file = File.fromURL(`https://mega.nz/file/${config.SESSION_ID}`);
            const data = await file.downloadBuffer();
            fs.mkdirSync(path.join(__dirname, 'auth_info'));
            fs.writeFileSync(path.join(__dirname, 'auth_info', 'creds.json'), data);
            console.log('✅ Session Downloaded Successfully!');
        } catch (e) {
            console.error('❌ Error downloading session:', e.message);
        }
    }
}

// ✅ FIX: Flags දෙකම Function එකෙන් එළියට (Global Scope එකට) ගත්තා!
// මේ නිසා බොට් Disconnect වෙලා Reconnect වුණත් මේ අගයන් Reset වෙන්නේ නෑ.
let isFirstStart = true;
let isScannerStarted = false;

async function startBot() {
    // Session පළමු සැරේ පමණක් download කරයි
    if (isFirstStart) {
        await downloadSession();
        isFirstStart = false;
    }

    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`🔄 Using WA v${version.join('.')}, isLatest: ${isLatest}`);

    const conn = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        auth: state,
        getMessage: async (key) => {
            return { conversation: 'Apex Crypto Bot' };
        }
    });

    conn.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            let reason = lastDisconnect?.error?.output?.statusCode;
            console.log(`⚠️ Connection Closed. Reason: ${reason}`);
            
            if (reason === DisconnectReason.loggedOut || reason === 440 || reason === 401) {
                console.log('❌ Session Invalid! Generate a NEW Session ID.');
                process.exit(1);
            } else {
                console.log('🔄 Reconnecting in 5 seconds...');
                conn.ev.removeAllListeners();
                setTimeout(startBot, 5000);
            }
        } else if (connection === 'open') {
            console.log('✅ Bot Connected to WhatsApp Successfully!');
            
            // ✅ FIX: Scanner එක රන් වෙන්නේ පළමු වතාවට පමණයි! (Multiple Loops හැදෙන්නේ නෑ)
            if (!isScannerStarted) {
                console.log('🔄 Starting Background Scanners...');
                startScanner(conn);
                isScannerStarted = true;
            } else {
                console.log('⚡ Scanner is already running. Reconnected safely.');
            }
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
