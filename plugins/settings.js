const { cmd } = require('../lib/commands');
const db = require('../lib/database');
const config = require('../config');

// ================= OWNER CONTROL PANEL =================
cmd({
    pattern: "settings",
    alias: ["botsettings", "control"],
    desc: "Bot Control Panel (Owner Only)",
    category: "owner",
    isOwner: true,
    react: "⚙️",
    filename: __filename
},
async (conn, mek, m, { reply }) => {
    try {
        const s = await db.getSettings();
        let msg = `╔═══════════════════════════╗\n`;
        msg += `║   ⚙️ *APEX-MD CONTROL PANEL* ║\n`;
        msg += `╚═══════════════════════════╝\n\n`;
        
        msg += `*1. Auto Signals:* ${s.autoSignal ? '✅ ON' : '❌ OFF'}\n`;
        msg += `   _(හැම 15m වරක්ම BTC, ETH, SOL ස්වයංක්‍රීයව scan කර signals යවයි)_\n\n`;
        
        msg += `*2. Trailing SL:* ${s.trailingSl ? '✅ ON' : '❌ OFF'}\n`;
        msg += `   _(Trade එක 50% ලාභ වූ විට SL අගය Entry මට්ටමට Auto මාරු කරයි)_\n\n`;
        
        msg += `*3. Trend Filter:* ${s.trendFilter ? '✅ ON' : '❌ OFF'}\n`;
        msg += `   _(මාකට් එක Extreme Fear (දැඩි අවදානම්) නම් trades ලබාදීම නවතයි)_\n\n`;

        // 🚀 අලුතින් එකතු කළ Strict Mode කෑල්ල
        msg += `*4. Strict Mode:* ${s.strictMode ? '✅ ON' : '❌ OFF'}\n`;
        msg += `   _(අවදානම් අවස්ථාවලදී බොරු ටාගට් නොදී 'WAIT' තීරණය ගනී)_\n\n`;
        
        msg += `> 📌 *වෙනස් කිරීමට:* ${config.PREFIX}set <අංකය> <on/off>\n`;
        msg += `> *උදා:* ${config.PREFIX}set 4 off`;
        
        await reply(msg);
    } catch (e) { await reply('❌ Error: ' + e.message); }
});

// ================= CHANGE SETTINGS =================
cmd({
    pattern: "set",
    desc: "Change bot settings",
    category: "owner",
    isOwner: true,
    react: "🔄",
    filename: __filename
},
async (conn, mek, m, { reply, args }) => {
    try {
        if (!args[0] || !args[1]) return await reply(`❌ කරුණාකර නිවැරදිව ලබා දෙන්න.\n*උදා:* ${config.PREFIX}set 4 off`);
        
        const num = args[0];
        const state = args[1].toLowerCase() === 'on';
        
        let updateData = {};
        let featureName = "";

        if (num === '1') { updateData.autoSignal = state; featureName = "Auto Signals"; }
        else if (num === '2') { updateData.trailingSl = state; featureName = "Trailing SL"; }
        else if (num === '3') { updateData.trendFilter = state; featureName = "Trend Filter"; }
        else if (num === '4') { updateData.strictMode = state; featureName = "Strict Mode"; } // 👈 අලුත් Setting ලොජික් එක
        else return await reply('❌ වැරදි අංකයකි! 1, 2, 3 හෝ 4 භාවිතා කරන්න.');

        await db.updateSettings(updateData);
        await reply(`✅ *${featureName}* පහසුකම සාර්ථකව ${state ? 'ON' : 'OFF'} කරන ලදී!`);
    } catch (e) { await reply('❌ Error: ' + e.message); }
});
