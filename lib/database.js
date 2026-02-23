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
    margin: { type: Number, default: 0 }, // 👈 මේක අලුතින් එකතු කළා
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

const tradeSchema = new mongoose.Schema({
    userJid: { type: String, required: true },
    coin: { type: String, required: true },
    type: { type: String, default: 'future' },
    entry: { type: Number, required: true },
    tp: { type: Number, required: true },
    sl: { type: Number, required: true },
    status: { type: String, default: 'active' },
    createdAt: { type: Date, default: Date.now }
});

const botSettingsSchema = new mongoose.Schema({
    id: { type: String, default: 'global' },
    autoSignal: { type: Boolean, default: false },
    trailingSl: { type: Boolean, default: true },
    trendFilter: { type: Boolean, default: true } 
});

const User = mongoose.model('User', userSchema);
const Group = mongoose.model('Group', groupSchema);
const Warning = mongoose.model('Warning', warningSchema);
const CommandUsage = mongoose.model('CommandUsage', commandUsageSchema);
const Trade = mongoose.model('Trade', tradeSchema);
const BotSettings = mongoose.model('BotSettings', botSettingsSchema);

async function connectDB() {
    if (!config.MONGODB) {
        console.log('⚠️ MongoDB URL නැහැ. Database features disable වෙයි.');
        return false;
    }
    try {
        await mongoose.connect(config.MONGODB, { useNewUrlParser: true, useUnifiedTopology: true });
        console.log('✅ MongoDB connected successfully!');
        return true;
    } catch (error) {
        console.log('❌ MongoDB connection failed:', error.message);
        return false;
    }
}

// 👈 අලුතින් එකතු කළ Margin Functions 👉
async function saveMargin(jid, amount) {
    try {
        return await User.findOneAndUpdate({ jid }, { margin: amount }, { new: true, upsert: true });
    } catch (error) { return null; }
}

async function getMargin(jid) {
    try {
        const user = await User.findOne({ jid });
        return user ? user.margin : 0;
    } catch (error) { return 0; }
}

// අනිත් Functions
async function getUser(jid) { try { let u = await User.findOne({ jid }); if(!u) u = await new User({jid}).save(); return u; } catch(e){return null;} }
async function updateUser(jid, data) { try { return await User.findOneAndUpdate({ jid }, data, { new: true, upsert: true }); } catch(e){return null;} }
async function getGroup(jid) { try { let g = await Group.findOne({ jid }); if(!g) g = await new Group({jid, name:'Unknown Group'}).save(); return g; } catch(e){return null;} }
async function updateGroup(jid, data) { try { return await Group.findOneAndUpdate({ jid }, data, { new: true, upsert: true }); } catch(e){return null;} }
async function saveTrade(data) { try { return await new Trade(data).save(); } catch(e){return null;} }
async function getActiveTrades(userJid) { try { return await Trade.find({ userJid, status: 'active' }); } catch(e){return [];} }
async function deleteTrade(id) { try { return await Trade.findByIdAndDelete(id); } catch(e){return false;} }

module.exports = {
    connectDB, User, Group, Warning, CommandUsage, Trade, BotSettings,
    getUser, updateUser, getGroup, updateGroup, saveTrade, getActiveTrades, deleteTrade,
    saveMargin, getMargin // 👈 Export කළා
};
