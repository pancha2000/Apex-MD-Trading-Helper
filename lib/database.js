const mongoose = require('mongoose');
const config = require('../config');

const userSchema = new mongoose.Schema({
    jid: { type: String, required: true, unique: true },
    name: { type: String, default: 'User' },
    warnings: { type: Number, default: 0 },
    banned: { type: Boolean, default: false },
    banExpiry: { type: Date },
    premium: { type: Boolean, default: false },
    premiumExpiry: { type: Date },
    coins: { type: Number, default: 0 },
    xp: { type: Number, default: 0 },
    level: { type: Number, default: 1 },
    lastSeen: { type: Date, default: Date.now },
    commandsUsed: { type: Number, default: 0 },
    margin: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});

const groupSchema = new mongoose.Schema({
    jid: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    antilink: { type: Boolean, default: false },
    antilinkAction: { type: String, default: 'kick', enum: ['kick', 'warn', 'delete'] },
    welcome: { type: Boolean, default: false },
    goodbye: { type: Boolean, default: false },
    welcomeMessage: { type: String, default: '👋 Welcome @user to @group!' },
    goodbyeMessage: { type: String, default: '👋 Goodbye @user!' },
    antibot: { type: Boolean, default: false },
    mute: { type: Boolean, default: false },
    bannedWords: [{ type: String }],
    economy: { type: Boolean, default: false },
    levelSystem: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

const warningSchema = new mongoose.Schema({
    userJid: { type: String, required: true },
    groupJid: { type: String, required: true },
    reason: { type: String, required: true },
    warnedBy: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});

const commandUsageSchema = new mongoose.Schema({
    command: { type: String, required: true },
    userJid: { type: String, required: true },
    groupJid: { type: String },
    timestamp: { type: Date, default: Date.now }
});

// ✅ UPGRADED Trade Schema - Partial TP + Journal support
const tradeSchema = new mongoose.Schema({
    userJid:   { type: String, required: true },
    coin:      { type: String, required: true },
    type:      { type: String, default: 'future' },
    direction: { type: String, default: 'LONG' },       // ✅ NEW: LONG/SHORT
    entry:     { type: Number, required: true },
    tp:        { type: Number, required: true },
    tp1:       { type: Number, default: null },          // ✅ NEW: Partial TP1
    sl:        { type: Number, required: true },
    rrr:       { type: String, default: 'N/A' },         // ✅ NEW: RRR stored
    tp1Hit:    { type: Boolean, default: false },        // ✅ NEW: TP1 already alerted?
    status:    { type: String, default: 'active' },
    result:    { type: String, default: null },          // ✅ NEW: 'WIN'/'LOSS'
    pnlPct:    { type: Number, default: null },          // ✅ NEW: P&L %
    closedAt:  { type: Date, default: null },            // ✅ NEW: when closed
    createdAt: { type: Date, default: Date.now }
});

const botSettingsSchema = new mongoose.Schema({
    id:          { type: String, default: 'global' },
    autoSignal:  { type: Boolean, default: false },
    trailingSl:  { type: Boolean, default: true },
    trendFilter: { type: Boolean, default: true },
    strictMode:  { type: Boolean, default: true },
    minRRR:      { type: Number, default: 1.5 },         // ✅ NEW: Minimum RRR filter
    partialTp:   { type: Boolean, default: true }        // ✅ NEW: Partial TP alerts
});

const User        = mongoose.model('User', userSchema);
const Group       = mongoose.model('Group', groupSchema);
const Warning     = mongoose.model('Warning', warningSchema);
const CommandUsage= mongoose.model('CommandUsage', commandUsageSchema);
const Trade       = mongoose.model('Trade', tradeSchema);
const BotSettings = mongoose.model('BotSettings', botSettingsSchema);

async function connectDB() {
    if (!config.MONGODB) {
        console.log('⚠️ MongoDB URL නැහැ. Database features disable.');
        return false;
    }
    try {
        await mongoose.connect(config.MONGODB, { useNewUrlParser: true, useUnifiedTopology: true });
        console.log('✅ MongoDB connected!');
        return true;
    } catch (error) {
        console.log('❌ MongoDB failed:', error.message);
        return false;
    }
}

async function saveMargin(jid, amount) {
    try { return await User.findOneAndUpdate({ jid }, { margin: amount }, { new: true, upsert: true }); } catch(e) { return null; }
}
async function getMargin(jid) {
    try { const u = await User.findOne({ jid }); return u ? u.margin : 0; } catch(e) { return 0; }
}

async function getSettings() {
    try {
        let s = await BotSettings.findOne({ id: 'global' });
        if (!s) s = await new BotSettings({ id: 'global' }).save();
        return s;
    } catch(e) {
        return { autoSignal: false, trailingSl: true, trendFilter: true, strictMode: true, minRRR: 1.5, partialTp: true };
    }
}
async function updateSettings(data) {
    try { return await BotSettings.findOneAndUpdate({ id: 'global' }, data, { new: true, upsert: true }); } catch(e) { return null; }
}

async function getUser(jid)           { try { let u = await User.findOne({ jid }); if (!u) u = await new User({ jid }).save(); return u; } catch(e) { return null; } }
async function updateUser(jid, data)  { try { return await User.findOneAndUpdate({ jid }, data, { new: true, upsert: true }); } catch(e) { return null; } }
async function getGroup(jid)          { try { let g = await Group.findOne({ jid }); if (!g) g = await new Group({ jid, name: 'Unknown' }).save(); return g; } catch(e) { return null; } }
async function updateGroup(jid, data) { try { return await Group.findOneAndUpdate({ jid }, data, { new: true, upsert: true }); } catch(e) { return null; } }

async function saveTrade(data) { try { return await new Trade(data).save(); } catch(e) { return null; } }
async function getActiveTrades(userJid) { try { return await Trade.find({ userJid, status: 'active' }); } catch(e) { return []; } }
async function deleteTrade(id) { try { return await Trade.findByIdAndDelete(id); } catch(e) { return false; } }

// ✅ NEW: Close trade with result for journal
async function closeTrade(tradeId, result, pnlPct) {
    try {
        return await Trade.findByIdAndUpdate(tradeId, {
            status: 'closed',
            result,        // 'WIN' or 'LOSS'
            pnlPct,
            closedAt: new Date()
        }, { new: true });
    } catch(e) { return null; }
}

// ✅ NEW: Get trade journal stats for a user
async function getTradeStats(userJid) {
    try {
        const closed = await Trade.find({ userJid, status: 'closed' }).sort({ closedAt: -1 });
        const active = await Trade.find({ userJid, status: 'active' });

        const wins   = closed.filter(t => t.result === 'WIN').length;
        const losses = closed.filter(t => t.result === 'LOSS').length;
        const total  = closed.length;
        const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : 0;

        // Total P&L
        const totalPnl = closed.reduce((sum, t) => sum + (t.pnlPct || 0), 0).toFixed(2);

        // Best & Worst trade
        const best  = closed.reduce((a, b) => (a.pnlPct || 0) > (b.pnlPct || 0) ? a : b, {});
        const worst = closed.reduce((a, b) => (a.pnlPct || 0) < (b.pnlPct || 0) ? a : b, {});

        // Streak calculation
        let streak = 0, maxStreak = 0, currStreak = 0, lastResult = null;
        for (let t of closed) {
            if (t.result === lastResult) { currStreak++; }
            else { currStreak = 1; lastResult = t.result; }
            if (lastResult === 'WIN') maxStreak = Math.max(maxStreak, currStreak);
        }
        const currentStreak = closed.length > 0 ? closed[0].result : null;

        // Recent 5 trades
        const recent = closed.slice(0, 5).map(t =>
            `${t.result === 'WIN' ? '🟢' : '🔴'} ${t.coin} (${t.direction || 'N/A'}) ${t.pnlPct > 0 ? '+' : ''}${(t.pnlPct || 0).toFixed(1)}%`
        );

        return { wins, losses, total, winRate, totalPnl, best, worst, maxStreak, currentStreak, recent, active: active.length };
    } catch(e) { return null; }
}

module.exports = {
    connectDB, User, Group, Warning, CommandUsage, Trade, BotSettings,
    getUser, updateUser, getGroup, updateGroup,
    saveTrade, getActiveTrades, deleteTrade, closeTrade, getTradeStats,
    saveMargin, getMargin, getSettings, updateSettings
};