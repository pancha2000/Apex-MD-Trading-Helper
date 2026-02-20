/**
 * ╔═══════════════════════════════════════════╗
 * ║   APEX-MD V2 ENHANCED - WhatsApp Bot      ║
 * ║     Created by: Shehan Vimukthi           ║
 * ║     Enhanced with AI Features             ║
 * ║     + Advanced Error Handler              ║
 * ╚═══════════════════════════════════════════╝
 */

const Baileys = require('@whiskeysockets/baileys');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    Browsers,
    delay
} = Baileys;

const makeInMemoryStore = Baileys.makeInMemoryStore || null;

const pino = require('pino');
const fs = require('fs');
const path = require('path');
const express = require('express');
const qrcode = require('qrcode-terminal');
const { File } = require('megajs');

const config = require('./config');
const { connectDB, getGroup, updateGroup, getUser, updateUser, addWarning, getWarnings, clearWarnings } = require('./lib/database');
const { handler } = require('./lib/commands');
const { serialize } = require('./lib/functions');

// 🔥 IMPORT ERROR HANDLER
const { 
    setupGlobalErrorHandlers, 
    sendErrorToOwner, 
    withErrorHandler,
    sendStartupNotification 
} = require('./lib/errorHandler');

// Express server
const app = express();
const PORT = config.PORT || 8000;

// Store
let store = null;
if (makeInMemoryStore && typeof makeInMemoryStore === 'function') {
    try {
        store = makeInMemoryStore({ 
            logger: pino().child({ level: 'silent', stream: 'store' }) 
        });
        console.log('✅ Message store enabled');
    } catch (e) {
        console.log('⚠️  Store initialization failed:', e.message);
    }
} else {
    console.log('⚠️  makeInMemoryStore not available in this Baileys version');
}

// Auth folder
const authFolder = path.join(__dirname, 'auth_info');
if (!fs.existsSync(authFolder)) {
    fs.mkdirSync(authFolder, { recursive: true });
}

// Temp folder
const tempFolder = path.join(__dirname, 'temp');
if (!fs.existsSync(tempFolder)) {
    fs.mkdirSync(tempFolder, { recursive: true });
}

/**
 * Load all plugins with error handling
 */
const loadPlugins = withErrorHandler('Plugin Loading')(function() {
    const pluginFolder = path.join(__dirname, 'plugins');
    
    if (!fs.existsSync(pluginFolder)) {
        console.log('⚠️  Plugins folder නැහැ!');
        return;
    }

    let loaded = 0;
    let failed = 0;

    // Load root level plugins only (no subdirectories)
    const rootFiles = fs.readdirSync(pluginFolder);
    rootFiles.forEach(file => {
        if (file.endsWith('.js')) {
            try {
                require(path.join(pluginFolder, file));
                loaded++;
            } catch (e) {
                console.log(`❌ Plugin Load Error [${file}]:`, e.message);
                failed++;
            }
        }
    });

    console.log(`✅ Loaded ${loaded} plugins successfully`);
    if (failed > 0) {
        console.log(`⚠️  ${failed} plugins failed to load`);
    }
});

/**
 * Download session from Mega.nz with error handling
 */
const downloadSession = withErrorHandler('Session Download')(async function() {
    if (!config.SESSION_ID) {
        console.log('⚠️  SESSION_ID නැහැ config.env එකේ!');
        return false;
    }

    if (fs.existsSync(path.join(authFolder, 'creds.json'))) {
        console.log('✅ Session දැනටමත් තියනවා');
        return true;
    }

    console.log('📥 Downloading session from Mega.nz...');

    try {
        let sessionUrl = config.SESSION_ID.trim();

        sessionUrl = sessionUrl.replace(/^APEX~/i, '');
        sessionUrl = sessionUrl.replace(/^apex-md~/i, '');
        sessionUrl = sessionUrl.replace(/^apex~/i, '');

        if (!sessionUrl.includes('mega.nz')) {
            sessionUrl = `https://mega.nz/file/${sessionUrl}`;
        }

        console.log('🔗 Mega File Code:', sessionUrl.split('/file/')[1] || sessionUrl);

        const file = File.fromURL(sessionUrl);
        await file.loadAttributes();
        
        // Add timeout
        const downloadPromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Download timeout - 60 seconds exceeded'));
            }, 60000);

            file.download((err, data) => {
                clearTimeout(timeout);
                if (err) reject(err);
                else resolve(data);
            });
        });

        const data = await downloadPromise;

        if (!fs.existsSync(authFolder)) {
            fs.mkdirSync(authFolder, { recursive: true });
        }

        fs.writeFileSync(path.join(authFolder, 'creds.json'), data);
        console.log('✅ Session download කරන එක සාර්ථකයි!');
        return true;

    } catch (error) {
        console.log('❌ Mega Session Download Failed:', error.message);
        console.log('💡 Tip: Mega link එක හරිද බලන්න');
        throw error; // Let error handler catch this
    }
});

/**
 * Start bot connection with error handling
 */
async function startBot() {
    console.log('');
    console.log('╔═══════════════════════════════════════════╗');
    console.log('║    🚀 APEX-MD V2 ENHANCED Starting...   ║');
    console.log('║    🛡️  Advanced Error Handler Active     ║');
    console.log('╚═══════════════════════════════════════════╝');
    console.log('');

    let conn = null;

    try {
        // Download session
        if (config.SESSION_ID) {
            await downloadSession();
        }

        // Connect to database
        if (config.MONGODB) {
            await connectDB();
        }

        // Load plugins
        loadPlugins();

        const { state, saveCreds } = await useMultiFileAuthState(authFolder);
        const { version } = await fetchLatestBaileysVersion();

        conn = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: config.USE_PAIRING_CODE === 'false',
            browser: Browsers.ubuntu('APEX-MD'),
            auth: state,
            getMessage: async (key) => {
                try {
                    // ✅ VALIDATION: Check if key exists
                    if (!key || typeof key !== 'object') {
                        return undefined;
                    }
                    
                    // ✅ VALIDATION: Check if remoteJid exists
                    if (!key.remoteJid || typeof key.remoteJid !== 'string') {
                        return undefined;
                    }
                    
                    if (store) {
                        const msg = await store.loadMessage(key.remoteJid, key.id);
                        return msg?.message || undefined;
                    }
                    return { conversation: 'APEX-MD' };
                } catch (e) {
                    console.log('⚠️  getMessage error:', e.message);
                    return undefined;
                }
            }
        });

        // 🔥 SETUP GLOBAL ERROR HANDLERS
        setupGlobalErrorHandlers(conn);

        // Pairing code support
        if (config.USE_PAIRING_CODE === 'true' && !conn.authState.creds.registered) {
            if (!config.PHONE_NUMBER) {
                console.log('⚠️  PHONE_NUMBER නැහැ! config.env එකේ add කරන්න.');
                process.exit(0);
            }

            setTimeout(async () => {
                try {
                    const code = await conn.requestPairingCode(config.PHONE_NUMBER);
                    console.log('');
                    console.log('╔═══════════════════════════════════════════╗');
                    console.log(`║    Pairing Code: ${code}                ║`);
                    console.log('╚═══════════════════════════════════════════╝');
                    console.log('');
                } catch (e) {
                    await sendErrorToOwner(conn, e, 'Pairing Code Generation');
                }
            }, 3000);
        }

        // Bind store
        store?.bind(conn.ev);

        // Save credentials
        conn.ev.on('creds.update', saveCreds);

        // Connection updates
        conn.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            
            if (connection === 'open') {
                console.log('✅ Bot connected වෙලා!');
                
                // 🔥 SEND STARTUP NOTIFICATION TO OWNER
                await sendStartupNotification(conn);
            }
            
            if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                console.log('Connection closed:', lastDisconnect?.error, 'Reconnecting:', shouldReconnect);
                
                if (shouldReconnect) {
                    setTimeout(() => startBot(), 3000);
                } else {
                    // Logged out - send notification
                    try {
                        await sendErrorToOwner(conn, 
                            new Error('Bot logged out from WhatsApp'), 
                            'Connection - Logged Out'
                        );
                    } catch (e) {
                        console.log('Failed to send logout notification');
                    }
                }
            }
        });

        // Messages handler with comprehensive error handling
        conn.ev.on('messages.upsert', async ({ messages }) => {
            try {
                // ✅ VALIDATION: Check if messages array exists and has items
                if (!messages || !Array.isArray(messages) || messages.length === 0) {
                    return;
                }

                const mek = messages[0];
                
                // ✅ VALIDATION: Check if message object exists
                if (!mek || typeof mek !== 'object') {
                    return;
                }

                // ✅ VALIDATION: Check if message has required properties
                if (!mek.message || !mek.key) {
                    return;
                }

                // ✅ VALIDATION: Check remoteJid exists (FIX FOR ERROR)
                if (!mek.key.remoteJid || typeof mek.key.remoteJid !== 'string') {
                    console.log('⚠️  Invalid message - missing or invalid remoteJid');
                    return;
                }

                const m = await serialize(mek, conn);
                
                // ✅ If serialize returns null, skip message
                if (!m) {
                    return;
                }
                
                const body = m.body;

                // Auto read
                if (config.AUTO_READ === 'true') {
                    await conn.readMessages([mek.key]);
                }

                // Status auto read/react
                if (m.from === 'status@broadcast') {
                    if (config.AUTO_STATUS_READ === 'true') {
                        await conn.readMessages([mek.key]);
                    }
                    return;
                }

                // Ignore own messages
                if (m.sender === conn.user.id) return;

                // Auto typing/recording
                if (config.AUTO_TYPING === 'true') {
                    await conn.sendPresenceUpdate('composing', m.from);
                }
                if (config.AUTO_RECORDING === 'true') {
                    await conn.sendPresenceUpdate('recording', m.from);
                }

                // Antilink protection (with error handling)
                if (m.isGroup && body) {
                    try {
                        const group = await getGroup(m.from);
                        if (group?.antilink) {
                            const linkRegex = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|([a-zA-Z0-9-]+\.(com|net|org|io|co|me|app|dev|xyz|info|tech))/gi;
                            const hasLink = linkRegex.test(body);

                            if (hasLink) {
                                const isAdmin = m.isAdmin;
                                const isBotAdmin = m.isBotAdmin;

                                if (!isAdmin && isBotAdmin) {
                                    await conn.sendMessage(m.from, { delete: mek.key });

                                    if (group.antilinkAction === 'kick') {
                                        await conn.groupParticipantsUpdate(m.from, [m.sender], 'remove');
                                        await conn.sendMessage(m.from, {
                                            text: `🚫 @${m.sender.split('@')[0]} link එකක් යැව්වා හින්දා kick කරන ලදී!`,
                                            mentions: [m.sender]
                                        });
                                    } else if (group.antilinkAction === 'warn') {
                                        await addWarning(m.sender, m.from, 'Sent a link', conn.user.id);
                                        const warnings = await getWarnings(m.sender, m.from);
                                        
                                        if (warnings.length >= 3) {
                                            await conn.groupParticipantsUpdate(m.from, [m.sender], 'remove');
                                            await clearWarnings(m.sender, m.from);
                                            await conn.sendMessage(m.from, {
                                                text: `🚫 @${m.sender.split('@')[0]} warnings 3ක් හින්දා kick කරන ලදී!`,
                                                mentions: [m.sender]
                                            });
                                        } else {
                                            await conn.sendMessage(m.from, {
                                                text: `⚠️ @${m.sender.split('@')[0]} warned! Links යවන්න එපා!\nWarnings: ${warnings.length}/3`,
                                                mentions: [m.sender]
                                            });
                                        }
                                    } else {
                                        await conn.sendMessage(m.from, {
                                            text: `❌ @${m.sender.split('@')[0]} links යවන්න බැහැ!`,
                                            mentions: [m.sender]
                                        });
                                    }
                                    
                                    return;
                                }
                            }
                        }
                    } catch (e) {
                        console.log('Antilink error:', e.message);
                        await sendErrorToOwner(conn, e, 'Antilink Feature');
                    }
                }

                // Command processing with error handling
                const prefix = config.PREFIX;
                
                if (!body.startsWith(prefix)) return;

                const args = body.slice(prefix.length).trim().split(/ +/);
                const cmdName = args[0].toLowerCase();
                const text = args.slice(1).join(' ');

                const cmd = handler.findCommand(cmdName);
                if (!cmd) return;

                // Check if user is banned
                try {
                    const user = await getUser(m.sender);
                    if (user?.banned) {
                        if (user.banExpiry && user.banExpiry < new Date()) {
                            await updateUser(m.sender, { banned: false, banExpiry: null });
                        } else {
                            return await conn.sendMessage(m.from, {
                                text: '❌ ඔබ bot එක use කරන්න ban කරලා තියෙනවා!'
                            }, { quoted: mek });
                        }
                    }
                } catch (e) {
                    console.log('User ban check error:', e.message);
                }

                // Check permissions
                const isOwner = config.isOwner(m.sender);
                
                if (cmd.isOwner && !isOwner) {
                    return await conn.sendMessage(m.from, {
                        text: '❌ මේ command එක owner විතරයි use කරන්න පුළුවන්!'
                    }, { quoted: mek });
                }

                if (cmd.isGroup && !m.isGroup) {
                    return await conn.sendMessage(m.from, {
                        text: '❌ මේ command එක groups වලයි use කරන්න පුළුවන්!'
                    }, { quoted: mek });
                }

                if (cmd.isPrivate && m.isGroup) {
                    return await conn.sendMessage(m.from, {
                        text: '❌ මේ command එක inbox එකේ විතරයි use කරන්න පුළුවන්!'
                    }, { quoted: mek });
                }

                if (cmd.react) {
                    await conn.sendMessage(m.from, {
                        react: { text: cmd.react, key: mek.key }
                    });
                }

                if (config.DEBUG === 'true') {
                    console.log(`[CMD] ${m.sender.split('@')[0]}: ${body}`);
                }

                // Execute command with error handling
                try {
                    const extra = {
                        conn,
                        m,
                        text,
                        args,
                        isOwner,
                        reply: async (text) => {
                            return await conn.sendMessage(m.from, { text }, { quoted: mek });
                        },
                        react: async (emoji) => {
                            return await conn.sendMessage(m.from, {
                                react: { text: emoji, key: mek.key }
                            });
                        }
                    };

                    await cmd.function(conn, mek, m, extra);

                    // Log command usage
                    if (config.MONGODB) {
                        const { logCommand } = require('./lib/database');
                        await logCommand(cmd.pattern, m.sender, m.isGroup ? m.from : null);
                    }

                } catch (cmdError) {
                    console.log(`❌ Command Error [${cmd.pattern}]:`, cmdError.message);
                    
                    // 🔥 SEND ERROR TO OWNER
                    await sendErrorToOwner(conn, cmdError, `Command: ${cmd.pattern}`);
                    
                    // Notify user
                    await conn.sendMessage(m.from, {
                        text: `❌ Command එක run කරද්දී error එකක්!\n\n_Error එක owner ට auto ම send කරලා._`
                    }, { quoted: mek });
                }

            } catch (messageError) {
                // Detailed error logging
                if (messageError.message && messageError.message.includes('remoteJid')) {
                    console.log('⚠️  Caught remoteJid error - skipping message silently');
                    // Don't send spam errors to owner for this common issue
                    return;
                }
                
                console.log('❌ Message Handler Error:', messageError.message);
                console.log('📍 Error Location:', messageError.stack?.split('\n')[1] || 'Unknown');
                
                // 🔥 SEND ERROR TO OWNER (only for serious errors)
                if (conn && !messageError.message.includes('undefined')) {
                    await sendErrorToOwner(conn, messageError, 'Message Handler');
                }
                
                if (config.DEBUG === 'true') {
                    console.log('🐛 Full Error:', messageError);
                }
            }
        });

        return conn;

    } catch (startupError) {
        console.log('❌ Bot Startup Error:', startupError.message);
        
        // 🔥 TRY TO SEND ERROR TO OWNER (if conn available)
        if (conn) {
            await sendErrorToOwner(conn, startupError, 'Bot Startup');
        }
        
        // Retry after 10 seconds
        console.log('⏳ Retrying in 10 seconds...');
        setTimeout(() => startBot(), 10000);
    }
}

// Express routes
app.get('/', (req, res) => {
    res.send(`
        <html>
            <head>
                <title>APEX-MD V2 ENHANCED</title>
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        text-align: center;
                        padding: 50px;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        color: white;
                    }
                    .container {
                        background: rgba(255,255,255,0.1);
                        padding: 40px;
                        border-radius: 20px;
                        backdrop-filter: blur(10px);
                    }
                    h1 { font-size: 3em; margin-bottom: 20px; }
                    .status { color: #4ade80; font-weight: bold; font-size: 1.5em; }
                    .error-handler { color: #fbbf24; margin-top: 20px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>✅ APEX-MD V2 ENHANCED</h1>
                    <p class="status">Status: Active & Running</p>
                    <p class="error-handler">🛡️ Advanced Error Handler: ACTIVE</p>
                    <p style="margin-top: 30px;">
                        Created with ❤️ by Shehan Vimukthi<br>
                        Enhanced with AI + Auto Error Detection
                    </p>
                </div>
            </body>
        </html>
    `);
});

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        version: '2.0.0',
        enhanced: true,
        errorHandler: 'active'
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🌐 Web Server: http://localhost:${PORT}`);
    startBot();
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('');
    console.log('👋 Bot shutting down gracefully...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('');
    console.log('👋 Bot shutting down gracefully...');
    process.exit(0);
});
