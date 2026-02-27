const mongoose = require('mongoose');
const config = require('../config');

// ─── 1. BOT SETTINGS SCHEMA ───
const SettingsSchema = new mongoose.Schema({
    id: { type: String, default: 'bot_settings' },
    strictMode: { type: Boolean, default: true },
    minRRR: { type: Number, default: 1.5 },
    autoSignal: { type: Boolean, default: false },
    partialTp: { type: Boolean, default: true },
    trailingSl: { type: Boolean, default: true },
    
    // ✅ NEW: Paper Trade Settings
    paperTrade: { type: Boolean, default: false }, // Paper Trade On/Off
    paperMinScore: { type: Number, default: 5 }    // Trade එකක් Auto දාන්න ඕන අවම ලකුණු ගාණ
});

// ─── 2. USER SCHEMA (Wallet & Stats) ───
const UserSchema = new mongoose.Schema({
    jid: { type: String, required: true, unique: true },
    margin: { type: Number, default: 0 },
    
    // ✅ NEW: Virtual Wallet for Paper Trading
    paperBalance: { type: Number, default: 100 }, // ආරම්භක බොරු ශේෂය ඩොලර් 100යි
    paperTrades: { type: Number, default: 0 },
    paperWins: { type: Number, default: 0 },
    paperLosses: { type: Number, default: 0 }
});

// ─── 3. TRADE TRACKING SCHEMA ───
const TradeSchema = new mongoose.Schema({
    userJid: String,
    coin: String,
    type: String,
    direction: String,
    entry: Number,
    tp: Number,
    tp1: Number,
    sl: Number,
    rrr: String,
    status: { type: String, default: 'active' }, // active, pending, closed
    result: String, // WIN, LOSS, BREAK-EVEN
    pnlPct: Number,
    tp1Hit: { type: Boolean, default: false },
    
    // ✅ NEW: Is this a Paper Trade?
    isPaper: { type: Boolean, default: false },
    paperProfit: { type: Number, default: 0 } // මේ ට්‍රේඩ් එකෙන් ආපු ලාභය/පාඩුව (USD)
});

// ─── MODELS ───
const Settings = mongoose.model('Settings', SettingsSchema);
const User = mongoose.model('User', UserSchema);
const Trade = mongoose.model('Trade', TradeSchema);

// ─── DATABASE FUNCTIONS ───
async function connect() {
    if (mongoose.connection.readyState === 0) {
        await mongoose.connect(config.MONGODB || 'mongodb://localhost/whatsapp-bot', {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log('✅ Database Connected Successfully!');
    }
}

async function getSettings() {
    await connect();
    let settings = await Settings.findOne({ id: 'bot_settings' });
    if (!settings) {
        settings = await Settings.create({ id: 'bot_settings' });
    }
    return settings;
}

async function updateSettings(updates) {
    await connect();
    return await Settings.findOneAndUpdate({ id: 'bot_settings' }, updates, { new: true, upsert: true });
}

async function getUser(jid) {
    await connect();
    let user = await User.findOne({ jid });
    if (!user) {
        user = await User.create({ jid });
    }
    return user;
}

async function getMargin(jid) {
    const user = await getUser(jid);
    return user.margin;
}

async function setMargin(jid, amount) {
    await connect();
    await User.findOneAndUpdate({ jid }, { margin: amount }, { upsert: true });
}

// ✅ NEW: Update Virtual Balance when a Paper Trade closes
async function updatePaperBalance(jid, pnlAmount, isWin) {
    await connect();
    const user = await getUser(jid);
    user.paperBalance += pnlAmount; // ලාභ නම් එකතු වෙනවා, පාඩු නම් අඩු වෙනවා
    user.paperTrades += 1;
    if (isWin) user.paperWins += 1;
    else user.paperLosses += 1;
    
    await user.save();
    return user;
}

async function saveTrade(data) {
    await connect();
    const trade = new Trade(data);
    return await trade.save();
}

async function closeTrade(id, result, pnlPct, paperProfit = 0) {
    await connect();
    return await Trade.findByIdAndUpdate(id, { 
        status: 'closed', 
        result, 
        pnlPct,
        paperProfit 
    });
}

module.exports = {
    connect,
    connectDB: connect, // ✅ NEW: index.js එකට ඕන කරන නම මෙතනින් හැදුවා
    getSettings,
    updateSettings,
    getUser,
    getMargin,
    setMargin,
    updatePaperBalance,
    saveTrade,
    closeTrade,
    Trade,
    User
};