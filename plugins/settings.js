const { cmd } = require('../lib/commands');
const db = require('../lib/database');
const config = require('../config');

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
        const msg = `
╔═══════════════════════════╗
║  ⚙️ *APEX-MD CONTROL PANEL* ║
╚═══════════════════════════╝

*1. Auto Signals:* ${s.autoSignal ? '✅ ON' : '❌ OFF'}
   _(15m වරක් BTC/ETH/SOL auto scan)_

*2. Trailing SL:* ${s.trailingSl ? '✅ ON' : '❌ OFF'}
   _(50% profit ලැබූ විට SL Entry ලෙ move)_

*3. Trend Filter:* ${s.trendFilter ? '✅ ON' : '❌ OFF'}
   _(Extreme Fear ලෙ trades block)_

*4. Strict Mode:* ${s.strictMode ? '✅ ON' : '❌ OFF'}
   _(Score <4 හෝ RRR fail ලෙ WAIT output)_

*5. Partial TP Alerts:* ${s.partialTp ? '✅ ON' : '❌ OFF'}
   _(TP1 hit ලෙ 50% close alert)_

*6. Min RRR:* ${s.minRRR || 1.5}x
   _(ඉහළ ගිය trades filter කිරීමේ minimum)_

📌 *වෙනස් කිරීමට:*
${config.PREFIX}set 1 on/off  → Auto Signals
${config.PREFIX}set 2 on/off  → Trailing SL
${config.PREFIX}set 3 on/off  → Trend Filter
${config.PREFIX}set 4 on/off  → Strict Mode
${config.PREFIX}set 5 on/off  → Partial TP
${config.PREFIX}set 6 1.5     → Min RRR value`;

        await reply(msg.trim());
    } catch (e) { await reply('❌ Error: ' + e.message); }
});

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
        if (!args[0] || !args[1]) return await reply(`❌ නිවැරදිව ලබා දෙන්න.\n*උදා:* ${config.PREFIX}set 4 off`);

        const num   = args[0];
        const value = args[1].toLowerCase();
        const state = value === 'on';

        let updateData = {}, featureName = "";

        if (num === '1') { updateData.autoSignal = state;  featureName = "Auto Signals"; }
        else if (num === '2') { updateData.trailingSl = state;  featureName = "Trailing SL"; }
        else if (num === '3') { updateData.trendFilter = state; featureName = "Trend Filter"; }
        else if (num === '4') { updateData.strictMode = state;  featureName = "Strict Mode"; }
        else if (num === '5') { updateData.partialTp = state;   featureName = "Partial TP Alerts"; }
        else if (num === '6') {
            // ✅ RRR number value
            const rrrVal = parseFloat(value);
            if (isNaN(rrrVal) || rrrVal < 1.0 || rrrVal > 5.0) {
                return await reply('❌ Min RRR 1.0 - 5.0 අතර විය යුතුය.\nඋදා: .set 6 1.5');
            }
            updateData.minRRR = rrrVal;
            featureName = `Min RRR → ${rrrVal}x`;
        }
        else return await reply('❌ 1-6 අතර අංකයක් භාවිතා කරන්න.');

        await db.updateSettings(updateData);
        await reply(`✅ *${featureName}* ${num === '6' ? 'update' : (state ? 'ON' : 'OFF')} කරන ලදී!`);
        await m.react('✅');
    } catch (e) { await reply('❌ Error: ' + e.message); }
});