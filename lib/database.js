const mongoose = require('mongoose');
const config = require('../config');

// --- පරණ Schemas ටික (User, Group, Warning, CommandUsage) ---
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

// --- Trade Tracker Schema ---
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

// 🚀 අලුතින් එකතු කළ Bot Settings Schema 🚀
const botSettingsSchema = new mongoose.Schema({
    id: { type: String, default: 'global' },
    autoSignal: { type: Boolean, default: false }, // මුලින් OFF
    trailingSl: { type: Boolean, default: true },  // මුලින් ON
    trendFilter: { type: Boolean, default: true }  // මුලින් ON
});

// Create Models
const User = mongoose.model('User', userSchema);
const Group = mongoose.model('Group', groupSchema);
const Warning = mongoose.model('Warning', warningSchema);
const CommandUsage = mongoose.model('CommandUsage', commandUsageSchema);
const Trade = mongoose.model('Trade', tradeSchema);
const BotSettings = mongoose.model('BotSettings', botSettingsSchema); // අලුත් Model එක

// Connect to database
async function connectDB() {
    if (!config.MONGODB) {
        console.log('⚠️ MongoDB URL නැහැ. Database features disable වෙයි.');
        return false;
    }
    try {
        await mongoose.connect(config.MONGODB, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log('✅ MongoDB connected successfully!');
        return true;
    } catch (error) {
        console.log('❌ MongoDB connection failed:', error.message);
        return false;
    }
}

// --- පරණ Functions ---
async function getUser(jid) {
    try {
        let user = await User.findOne({ jid });
        if (!user) user = await new User({ jid }).save();
        return user;
    } catch (error) { return null; }
}

async function updateUser(jid, data) {
    try { return await User.findOneAndUpdate({ jid }, data, { new: true, upsert: true }); } 
    catch (error) { return null; }
}

async function banUser(jid, duration = 0) {
    try {
        const banExpiry = duration > 0 ? new Date(Date.now() + duration * 1000) : null;
        return await User.findOneAndUpdate({ jid }, { banned: true, banExpiry }, { new: true, upsert: true });
    } catch (error) { return null; }
}

async function unbanUser(jid) {
    try { return await User.findOneAndUpdate({ jid }, { banned: false, banExpiry: null }, { new: true }); } 
    catch (error) { return null; }
}

async function getGroup(jid) {
    try {
        let group = await Group.findOne({ jid });
        if (!group) group = await new Group({ jid, name: 'Unknown Group' }).save();
        return group;
    } catch (error) { return null; }
}

async function updateGroup(jid, data) {
    try { return await Group.findOneAndUpdate({ jid }, data, { new: true, upsert: true }); } 
    catch (error) { return null; }
}

async function addWarning(userJid, groupJid, reason, warnedBy) {
    try {
        const warning = await new Warning({ userJid, groupJid, reason, warnedBy }).save();
        const user = await getUser(userJid);
        if (user) { user.warnings += 1; await user.save(); }
        return warning;
    } catch (error) { return null; }
}

async function getWarnings(userJid, groupJid = null) {
    try {
        const query = { userJid };
        if (groupJid) query.groupJid = groupJid;
        return await Warning.find(query).sort({ createdAt: -1 });
    } catch (error) { return []; }
}

async function clearWarnings(userJid, groupJid = null) {
    try {
        const query = { userJid };
        if (groupJid) query.groupJid = groupJid;
        await Warning.deleteMany(query);
        const user = await getUser(userJid);
        if (user) { user.warnings = 0; await user.save(); }
        return true;
    } catch (error) { return false; }
}

async function logCommand(command, userJid, groupJid = null) {
    try {
        await new CommandUsage({ command, userJid, groupJid }).save();
        const user = await getUser(userJid);
        if (user) { user.commandsUsed += 1; await user.save(); }
    } catch (error) {}
}

async function getCommandStats() {
    try {
        return await CommandUsage.aggregate([
            { $group: { _id: '$command', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 10 }
        ]);
    } catch (error) { return []; }
}

// --- Trade Functions ---
async function saveTrade(data) {
    try { return await new Trade(data).save(); } 
    catch (error) { console.log('Error saving trade:', error); return null; }
}

async function getActiveTrades(userJid) {
    try { return await Trade.find({ userJid, status: 'active' }); } 
    catch (error) { return []; }
}

async function deleteTrade(id) {
    try { return await Trade.findByIdAndDelete(id); } 
    catch (error) { return false; }
}

// 🚀 අලුතින් එකතු කළ Bot Settings Functions 🚀
async function getSettings() {
    try {
        let settings = await BotSettings.findOne({ id: 'global' });
        // Database එකේ settings මුකුත් නැත්නම් අලුතින් හදලා සේව් කරනවා
        if (!settings) settings = await new BotSettings({ id: 'global' }).save();
        return settings;
    } catch (error) { 
        // Error එකක් ආවොත් (DB වැඩ නැත්නම්) Default අගයන් යවනවා
        return { autoSignal: false, trailingSl: true, trendFilter: true }; 
    }
}

async function updateSettings(data) {
    try { 
        // Owner දෙන අලුත් Settings ටික Database එකේ අප්ඩේට් කරනවා
        return await BotSettings.findOneAndUpdate({ id: 'global' }, data, { new: true, upsert: true }); 
    } catch (error) { return null; }
}

module.exports = {
    connectDB, User, Group, Warning, CommandUsage, Trade, BotSettings,
    getUser, updateUser, banUser, unbanUser, getGroup, updateGroup,
    addWarning, getWarnings, clearWarnings, logCommand, getCommandStats,
    saveTrade, getActiveTrades, deleteTrade,
    getSettings, updateSettings // 👈 අලුත් Exports
};
