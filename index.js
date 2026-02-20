/**
 * ╔═══════════════════════════════════════════╗
 * ║   CRYPTO AI TRADING BOT - OPTIMIZED       ║
 * ╚═══════════════════════════════════════════╝
 */

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');
const express = require('express');
const qrcode = require('qrcode-terminal');
const { File } = require('megajs');
const fs = require('fs');
const path = require('path');

const config = require('./config');
const { connectDB } = require('./lib/database');
const { handler } = require('./lib/commands');
const { serialize } = require('./lib/functions');

// Load Commands
require('fs').readdirSync('./plugins/').forEach(plugin => {
    if (path.extname(plugin).toLowerCase() == '.js') {
        require('./plugins/' + plugin);
    }
});

// Express server (Required for Koyeb to keep bot alive)
const app = express();
const PORT = process.env.PORT || 8000;

app.get('/', (req, res) => {
    res.send('🚀 Crypto AI Bot is Running Successfully!');
});

app.listen(PORT, () => {
    console.log(`🌐 Web Server running on port ${PORT}`);
});

// Download Session from Mega
async function downloadSession() {
    if (!fs.existsSync(path.join(__dirname, 'auth_info', 'creds.json')) && config.SESSION_ID) {
        console.log('📥 Downloading Session from Mega...');
        try {
            // "https://mega.nz/file/" කියන එක SESSION_ID එකට එකතු කරලා ගන්නවා
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

// Start WhatsApp Bot
async function startBot() {
    console.log('🔄 Starting Crypto AI Bot...');
    
    // Connect to Database
    if (config.MONGODB) await connectDB();

    // Download Session First
    await downloadSession();

    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    const conn = makeWASocket({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: true,
        browser: Browsers.macOS('Desktop'),
        auth: state
    });

    conn.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            let reason = lastDisconnect.error?.output?.statusCode;
            if (reason !== DisconnectReason.loggedOut) {
                console.log('🔄 Connection closed, reconnecting...');
                startBot();
            } else {
                console.log('❌ Logged out! Please delete auth_info folder, get a new SESSION_ID and restart.');
                fs.rmSync('./auth_info', { recursive: true, force: true });
            }
        } else if (connection === 'open') {
            console.log('✅ Bot Connected to WhatsApp!');
        }
    });

    conn.ev.on('creds.update', saveCreds);

    conn.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message) return;

        const mek = await serialize(conn, msg);
        if (!mek) return;

        const body = mek.body || '';
        const prefix = config.PREFIX || '.';
        const isCmd = body.startsWith(prefix);
        const command = isCmd ? body.slice(prefix.length).trim().split(' ').shift().toLowerCase() : '';
        const args = body.trim().split(/ +/).slice(1);
        const text = args.join(' ');

        if (isCmd) {
            const cmd = handler.findCommand(command);
            if (cmd) {
                try {
                    await cmd.function(conn, mek, msg, {
                        reply: async (text) => await conn.sendMessage(msg.key.remoteJid, { text: text }, { quoted: msg }),
                        text, args, body, command
                    });
                } catch (e) {
                    console.error('Command Error:', e);
                }
            }
        }
    });
}

startBot();
