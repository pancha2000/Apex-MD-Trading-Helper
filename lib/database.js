const mongoose = require('mongoose');
const config = require('../config');

const userSchema = new mongoose.Schema({
    jid: { type: String, required: true, unique: true },
    name: { type: String, default: 'User' },
    margin: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});

const tradeSchema = new mongoose.Schema({
    userJid:   { type: String, required: true },
    coin:      { type: String, required: true },
    type:      { type: String, default: 'future' },
    direction: { type: String, default: 'LONG' },       
    entry:     { type: Number, required: true },
    tp:        { type: Number, required: true },
    tp1:       { type: Number, default: null },          
    sl:        { type: Number, required: true },
    rrr:       { type: String, default: 'N/A' },         
    tp1Hit:    { type: Boolean, default: false },        
    status:    { type: String, default: 'active' },
    result:    { type: String, default: null },          
    pnlPct:    { type: Number, default: null },          
    closedAt:  { type: Date, default: null },            
    createdAt: { type: Date, default: Date.now }
});

const botSettingsSchema = new mongoose.Schema({
    id:          { type: String, default: 'global' },
    autoSignal:  { type: Boolean, default: false },
    trailingSl:  { type: Boolean, default: true },
    trendFilter: { type: Boolean, default: true },
    strictMode:  { type: Boolean, default: true },
    minRRR:      { type: Number, default: 1.5 },         
    partialTp:   { type: Boolean, default: true }        
});

const User = mongoose.model('User', userSchema);
const Trade = mongoose.model('Trade', tradeSchema);
const BotSettings = mongoose.model('BotSettings', botSettingsSchema);

async function connectDB() {
    if (!config.MONGODB) return false;
    try {
        await mongoose.connect(config.MONGODB, { useNewUrlParser: true, useUnifiedTopology: true });
        console.log('✅ MongoDB connected!');
        return true;
    } catch (error) { return false; }
}

async function saveMargin(jid, amount) { try { return await User.findOneAndUpdate({ jid }, { margin: amount }, { new: true, upsert: true }); } catch(e) { return null; } }
async function getMargin(jid) { try { const u = await User.findOne({ jid }); return u ? u.margin : 0; } catch(e) { return 0; } }
async function getSettings() { try { let s = await BotSettings.findOne({ id: 'global' }); if (!s) s = await new BotSettings({ id: 'global' }).save(); return s; } catch(e) { return { autoSignal: false, trailingSl: true, trendFilter: true, strictMode: true, minRRR: 1.5, partialTp: true }; } }
async function updateSettings(data) { try { return await BotSettings.findOneAndUpdate({ id: 'global' }, data, { new: true, upsert: true }); } catch(e) { return null; } }
async function saveTrade(data) { try { return await new Trade(data).save(); } catch(e) { return null; } }
async function getActiveTrades(userJid) { try { return await Trade.find({ userJid, status: 'active' }); } catch(e) { return []; } }
async function deleteTrade(id) { try { return await Trade.findByIdAndDelete(id); } catch(e) { return false; } }

async function closeTrade(tradeId, result, pnlPct) {
    try { return await Trade.findByIdAndUpdate(tradeId, { status: 'closed', result, pnlPct, closedAt: new Date() }, { new: true }); } catch(e) { return null; }
}

async function getTradeStats(userJid) {
    try {
        const closed = await Trade.find({ userJid, status: 'closed' }).sort({ closedAt: -1 });
        const active = await Trade.find({ userJid, status: 'active' });
        const wins = closed.filter(t => t.result === 'WIN').length, losses = closed.filter(t => t.result === 'LOSS').length;
        const total = closed.length, winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : 0;
        const totalPnl = closed.reduce((sum, t) => sum + (t.pnlPct || 0), 0).toFixed(2);
        const best = closed.reduce((a, b) => (a.pnlPct || 0) > (b.pnlPct || 0) ? a : b, {});
        const worst = closed.reduce((a, b) => (a.pnlPct || 0) < (b.pnlPct || 0) ? a : b, {});
        
        let maxStreak = 0, currStreak = 0, lastResult = null;
        for (let t of closed) {
            if (t.result === lastResult) { currStreak++; } else { currStreak = 1; lastResult = t.result; }
            if (lastResult === 'WIN') maxStreak = Math.max(maxStreak, currStreak);
        }
        const currentStreak = closed.length > 0 ? closed[0].result : null;
        const recent = closed.slice(0, 5).map(t => `${t.result === 'WIN' ? '🟢' : '🔴'} ${t.coin} (${t.direction || 'N/A'}) ${t.pnlPct > 0 ? '+' : ''}${(t.pnlPct || 0).toFixed(1)}%`);
        return { wins, losses, total, winRate, totalPnl, best, worst, maxStreak, currentStreak, recent, active: active.length };
    } catch(e) { return null; }
}

module.exports = { connectDB, User, Trade, BotSettings, saveTrade, getActiveTrades, deleteTrade, closeTrade, getTradeStats, saveMargin, getMargin, getSettings, updateSettings };
