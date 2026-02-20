const mongoose = require('mongoose');
const config = require('../config');

// User Schema
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

// Group Schema
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

// Warning Schema
const warningSchema = new mongoose.Schema({
    userJid: { type: String, required: true },
    groupJid: { type: String, required: true },
    reason: { type: String, required: true },
    warnedBy: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});

// Command Usage Schema
const commandUsageSchema = new mongoose.Schema({
    command: { type: String, required: true },
    userJid: { type: String, required: true },
    groupJid: { type: String },
    timestamp: { type: Date, default: Date.now }
});

// Create Models
const User = mongoose.model('User', userSchema);
const Group = mongoose.model('Group', groupSchema);
const Warning = mongoose.model('Warning', warningSchema);
const CommandUsage = mongoose.model('CommandUsage', commandUsageSchema);

// Connect to database
async function connectDB() {
    if (!config.MONGODB) {
        console.log('⚠️  MongoDB URL නැහැ. Database features disable වෙයි.');
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

// User functions
async function getUser(jid) {
    try {
        let user = await User.findOne({ jid });
        if (!user) {
            user = await new User({ jid }).save();
        }
        return user;
    } catch (error) {
        console.log('Error getting user:', error);
        return null;
    }
}

async function updateUser(jid, data) {
    try {
        return await User.findOneAndUpdate({ jid }, data, { new: true, upsert: true });
    } catch (error) {
        console.log('Error updating user:', error);
        return null;
    }
}

async function banUser(jid, duration = 0) {
    try {
        const banExpiry = duration > 0 ? new Date(Date.now() + duration * 1000) : null;
        return await User.findOneAndUpdate(
            { jid },
            { banned: true, banExpiry },
            { new: true, upsert: true }
        );
    } catch (error) {
        console.log('Error banning user:', error);
        return null;
    }
}

async function unbanUser(jid) {
    try {
        return await User.findOneAndUpdate(
            { jid },
            { banned: false, banExpiry: null },
            { new: true }
        );
    } catch (error) {
        console.log('Error unbanning user:', error);
        return null;
    }
}

// Group functions
async function getGroup(jid) {
    try {
        let group = await Group.findOne({ jid });
        if (!group) {
            group = await new Group({ jid, name: 'Unknown Group' }).save();
        }
        return group;
    } catch (error) {
        console.log('Error getting group:', error);
        return null;
    }
}

async function updateGroup(jid, data) {
    try {
        return await Group.findOneAndUpdate({ jid }, data, { new: true, upsert: true });
    } catch (error) {
        console.log('Error updating group:', error);
        return null;
    }
}

// Warning functions
async function addWarning(userJid, groupJid, reason, warnedBy) {
    try {
        const warning = await new Warning({
            userJid,
            groupJid,
            reason,
            warnedBy
        }).save();

        // Update user warnings count
        const user = await getUser(userJid);
        if (user) {
            user.warnings += 1;
            await user.save();
        }

        return warning;
    } catch (error) {
        console.log('Error adding warning:', error);
        return null;
    }
}

async function getWarnings(userJid, groupJid = null) {
    try {
        const query = { userJid };
        if (groupJid) query.groupJid = groupJid;
        return await Warning.find(query).sort({ createdAt: -1 });
    } catch (error) {
        console.log('Error getting warnings:', error);
        return [];
    }
}

async function clearWarnings(userJid, groupJid = null) {
    try {
        const query = { userJid };
        if (groupJid) query.groupJid = groupJid;
        await Warning.deleteMany(query);

        // Update user warnings count
        const user = await getUser(userJid);
        if (user) {
            user.warnings = 0;
            await user.save();
        }

        return true;
    } catch (error) {
        console.log('Error clearing warnings:', error);
        return false;
    }
}

// Command usage tracking
async function logCommand(command, userJid, groupJid = null) {
    try {
        await new CommandUsage({ command, userJid, groupJid }).save();
        
        // Update user command count
        const user = await getUser(userJid);
        if (user) {
            user.commandsUsed += 1;
            await user.save();
        }
    } catch (error) {
        console.log('Error logging command:', error);
    }
}

async function getCommandStats() {
    try {
        const stats = await CommandUsage.aggregate([
            { $group: { _id: '$command', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 10 }
        ]);
        return stats;
    } catch (error) {
        console.log('Error getting command stats:', error);
        return [];
    }
}

module.exports = {
    connectDB,
    User,
    Group,
    Warning,
    CommandUsage,
    getUser,
    updateUser,
    banUser,
    unbanUser,
    getGroup,
    updateGroup,
    addWarning,
    getWarnings,
    clearWarnings,
    logCommand,
    getCommandStats
};