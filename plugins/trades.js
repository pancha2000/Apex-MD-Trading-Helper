const { cmd } = require('../lib/commands');
const db = require('../lib/database');

// ================= VIEW TRADES =================
cmd({
    pattern: "mytrades",
    desc: "View active tracked trades",
    category: "crypto",
    react: "📊",
    filename: __filename
},
async (conn, mek, m, { reply }) => {
    try {
        const trades = await db.getActiveTrades(m.sender);
        if (!trades || trades.length === 0) return await reply('❌ ඔබට දැනට Track වන Active Trades කිසිවක් නොමැත.');

        let msg = `📊 *ඔබගේ Active Trades*\n\n`;
        trades.forEach((t, i) => {
            const tradeType = t.tp > t.entry ? 'LONG' : 'SHORT'; // TP එක Entry එකට වඩා වැඩි නම් Long
            msg += `*${i+1}. ${t.coin}* (${t.type.toUpperCase()} | ${tradeType})\n`;
            msg += `🎯 Entry: $${t.entry}\n💰 TP: $${t.tp}\n🛑 SL: $${t.sl}\n`;
            msg += `🆔 ID: ${t._id}\n\n`;
        });
        msg += `> Trade එකක් මකා දැමීමට *.deltrade <ID>* භාවිතා කරන්න.`;
        
        await reply(msg);
        await m.react('✅');
    } catch (e) {
        await reply('❌ Error: ' + e.message);
    }
});

// ================= DELETE TRADE =================
cmd({
    pattern: "deltrade",
    desc: "Delete a tracked trade",
    category: "crypto",
    react: "🗑️",
    filename: __filename
},
async (conn, mek, m, { reply, args }) => {
    try {
        if (!args[0]) return await reply('❌ කරුණාකර Trade ID එක ලබා දෙන්න!\n*උදා:* .deltrade 64abc123...');
        
        const id = args[0];
        const deleted = await db.deleteTrade(id);
        
        if (deleted) {
            await reply('✅ Trade එක සාර්ථකව මකා දමන ලදී. මින් පසු ඒ පිළිබඳ දැනුම්දීම් නොලැබේ.');
            await m.react('✅');
        } else {
            await reply('❌ Trade එක සොයාගත නොහැක. ID එක නිවැරදිදැයි පරීක්ෂා කරන්න.');
            await m.react('❌');
        }
    } catch (e) {
        await reply('❌ Error: ' + e.message);
    }
});
