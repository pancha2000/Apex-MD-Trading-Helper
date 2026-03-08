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
    paperTrade: { type: Boolean, default: false },
    paperMinScore: { type: Number, default: 5 }
});

// ─── 2. USER SCHEMA (Wallet & Stats) ───
const UserSchema = new mongoose.Schema({
    jid: { type: String, required: true, unique: true },
    margin: { type: Number, default: 0 },
    paperBalance: { type: Number, default: 100 },
    paperStartBalance: { type: Number, default: 100 },
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
    tp2: Number,
    sl: Number,
    rrr: String,
    status: { type: String, default: 'active' },      // active, pending, closed
    result: String,                                    // WIN, LOSS, BREAK-EVEN
    pnlPct: Number,
    tp1Hit: { type: Boolean, default: false },
    isPaper: { type: Boolean, default: false },
    paperProfit: { type: Number, default: 0 },
    leverage:    { type: Number, default: 1 },
    quantity:    { type: Number, default: 0 },
    marginUsed:  { type: Number, default: 0 },
    openTime:    { type: Date, default: Date.now },
    score:       { type: Number, default: 0 },
    timeframe:   { type: String, default: '15m' },
    orderType:   { type: String, default: 'MARKET' },
    tp2Hit:      { type: Boolean, default: false },
    dcaLevel:    { type: Number, default: 0 },
    fillPrice:   { type: Number, default: 0 },
    closedAt:    { type: Date, default: null },
    tp3:         { type: Number, default: 0 },
    // ✅ BUG 5 FIX: stale warning flag persisted to MongoDB
    // Old: trade._staleWarned was in-memory — lost on bot restart → warning re-fired
    staleWarned: { type: Boolean, default: false },
});

// ─── MODELS ───
// ✅ CRASH FIX: "OverwriteModelError: Cannot overwrite `Settings` model once compiled"
// Root cause: binance.js also calls mongoose.model('Settings', ...) which crashes
//             when database.js has already registered the same model name.
// Fix: mongoose.models.X returns the already-registered model if it exists,
//      otherwise registers a new one. Safe to call from multiple files.
const Settings = mongoose.models.Settings || mongoose.model('Settings', SettingsSchema);
const User     = mongoose.models.User     || mongoose.model('User',     UserSchema);
const Trade    = mongoose.models.Trade    || mongoose.model('Trade',    TradeSchema);

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
    if (!settings) settings = await Settings.create({ id: 'bot_settings' });
    return settings;
}

async function updateSettings(updates) {
    await connect();
    return await Settings.findOneAndUpdate({ id: 'bot_settings' }, updates, { new: true, upsert: true });
}

async function getUser(jid) {
    await connect();
    let user = await User.findOne({ jid });
    if (!user) user = await User.create({ jid });
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

// ✅ BUG 2 FIX: Added countTrade param (default true).
// Partial TP1/TP2 calls pass countTrade=false to avoid inflating paperTrades counter 3x.
// Only the final close call passes countTrade=true (default).
async function updatePaperBalance(jid, pnlAmount, isWin, isBreakEven = false, countTrade = true) {
    await connect();
    const user = await getUser(jid);
    user.paperBalance += pnlAmount;
    if (countTrade) user.paperTrades += 1;   // ✅ Only count once per full trade
    if (isWin) user.paperWins += 1;
    else if (!isBreakEven) user.paperLosses += 1;
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
    return await Trade.findByIdAndUpdate(id, { status: 'closed', result, pnlPct, paperProfit, closedAt: new Date() });
}

async function getActiveTrades(jid) {
    await connect();
    return await Trade.find({ userJid: jid, status: { $in: ['active', 'pending'] }, isPaper: false });
}

async function getActivePaperTrades(jid) {
    await connect();
    return await Trade.find({ userJid: jid, status: { $in: ['active', 'pending'] }, isPaper: true });
}

async function deleteTrade(id) {
    await connect();
    try {
        const result = await Trade.findByIdAndDelete(id);
        return result != null;
    } catch (e) {
        return false;
    }
}

async function getTradeStats(jid) {
    await connect();
    const activeTrades = await Trade.countDocuments({ userJid: jid, status: { $in: ['active', 'pending'] }, isPaper: false });
    const closedTrades = await Trade.find({ userJid: jid, status: 'closed', isPaper: false }).sort({ _id: -1 });

    let wins = 0, losses = 0, totalPnl = 0;
    let best = null, worst = null;
    let currentStreakType = null, currentStreakCount = 0, maxStreak = 0;
    let recent = [];

    for (let i = 0; i < closedTrades.length; i++) {
        const t = closedTrades[i];
        if (recent.length < 5) {
            let resIcon = t.result === 'WIN' ? '🟢' : t.result === 'LOSS' ? '🔴' : '⚪';
            let pnlStr  = t.pnlPct ? (t.pnlPct > 0 ? '+' : '') + t.pnlPct.toFixed(2) + '%' : '';
            recent.push(`${resIcon} ${t.coin} (${t.direction}) ${pnlStr}`);
        }

        if (t.result === 'WIN')  wins++;
        else if (t.result === 'LOSS') losses++;

        let pnl = t.pnlPct || 0;
        totalPnl += pnl;

        if (!best  || pnl > best.pnlPct)  best  = t;
        if (!worst || pnl < worst.pnlPct) worst = t;

        // ✅ BUG 6 FIX: Proper streak tracking for BOTH win and loss streaks.
        // Old code never counted loss streaks and reset count to 0 on any loss.
        if (currentStreakType === null) {
            currentStreakType  = t.result;
            currentStreakCount = 1;
        } else if (t.result === currentStreakType) {
            currentStreakCount++;
            if (currentStreakType === 'WIN' && currentStreakCount > maxStreak) maxStreak = currentStreakCount;
        } else {
            currentStreakType  = t.result;
            currentStreakCount = 1;
        }
    }

    const totalClosed = wins + losses;
    const winRate = totalClosed > 0 ? ((wins / totalClosed) * 100).toFixed(2) : 0;

    return {
        active: activeTrades,
        total: closedTrades.length,
        wins, losses, winRate,
        totalPnl: totalPnl.toFixed(2),
        best, worst,
        currentStreak: currentStreakCount > 0 ? 'WIN' : (losses > 0 ? 'LOSS' : 'NONE'),
        maxStreak, recent
    };
}

async function setPaperCapital(jid, amount) {
    await connect();
    const user = await getUser(jid);
    user.paperBalance      = amount;
    user.paperStartBalance = amount;
    user.paperTrades       = 0;
    user.paperWins         = 0;
    user.paperLosses       = 0;
    await user.save();
    return user;
}

async function getFundingRate(coin) {
    try {
        const axios = require('axios');
        const res = await axios.get(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${coin}&limit=1`);
        if (res.data && res.data.length > 0) {
            const rate  = parseFloat(res.data[0].fundingRate) * 100;
            const emoji = rate > 0.05 ? '🔴' : rate < -0.05 ? '🟢' : '⚪';
            return `${emoji} ${rate.toFixed(4)}% (${rate > 0.05 ? 'Longs pay Shorts' : rate < -0.05 ? 'Shorts pay Longs' : 'Neutral'})`;
        }
        return 'N/A';
    } catch(e) { return 'N/A'; }
}

module.exports = {
    connect,
    connectDB: connect,
    getSettings,
    updateSettings,
    getUser,
    getMargin,
    setMargin,
    saveMargin: setMargin,
    updatePaperBalance,
    saveTrade,
    closeTrade,
    getActiveTrades,
    getActivePaperTrades,
    setPaperCapital,
    getFundingRate,
    deleteTrade,
    getTradeStats,
    Trade,
    User
};
