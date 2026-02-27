const { cmd } = require('../lib/commands');
const db = require('../lib/database');

cmd({
    pattern: "track",
    desc: "Save and track a crypto trade",
    category: "crypto",
    react: "🎯",
    filename: __filename
},
async (conn, mek, m, { reply }) => {
    try {
        if (!m.quoted) return await reply('❌ AI Analysis message එකට Reply කරමින් .track යවන්න.');

        const quotedText = m.quoted.conversation || m.quoted.extendedTextMessage?.text || m.quoted.text || m.quoted.body || "";
        if (!quotedText) return await reply('❌ Quoted message කියවීමට නොහැකිය.');

        const coinMatch = quotedText.match(/([A-Z]+)\s*\/\s*USDT/);
        
        if (!coinMatch) {
            if (quotedText.includes("⏳")) {
                return await reply('❌ කරුණාකර "⏳ Loading..." මැසේජ් එකට නොව, අවසාන Analysis Report එකට Reply කර .track යවන්න.');
            }
            return await reply('❌ නිවැරදි Analysis message එකක් නොවේ. (Coin එක සොයාගැනීමට නොහැක)');
        }
        
        const coin = coinMatch[1] + 'USDT';
        const type = quotedText.includes('SPOT') ? 'spot' : 'future';

        const targetMatch = quotedText.match(/ENTRY:\s*\$([0-9,.]+)\s*\|\s*TP:\s*\$([0-9,.]+)\s*\|\s*SL:\s*\$([0-9,.]+)/i);
        if (!targetMatch) return await reply('❌ Entry, TP, SL අගයන් සොයාගැනීමට නොහැක. (Track data නොමැත)');

        const entry = parseFloat(targetMatch[1].replace(/,/g, ''));
        const tp = parseFloat(targetMatch[2].replace(/,/g, ''));
        const sl = parseFloat(targetMatch[3].replace(/,/g, ''));

        const tp1Match = quotedText.match(/TP1.*?\s*\$([0-9,.]+)/);
        const tp1 = tp1Match ? parseFloat(tp1Match[1].replace(/,/g, '')) : null;

        // ✅ FIX: Bulletproof Direction Detection 
        // (SHORT අකුර හෝ 🔴 ලකුණ තිබුණොත් අනිවාර්යයෙන්ම SHORT, නැත්නම් LONG)
        let direction = 'LONG';
        if (quotedText.includes('SHORT') || quotedText.includes('🔴 SHORT') || quotedText.includes('Bearish')) {
            direction = 'SHORT';
        }

        const rrrMatch = quotedText.match(/RRR.*?(1:[\d.]+)/);
        const rrr = rrrMatch ? rrrMatch[1] : 'N/A';

        const isLimit = quotedText.includes('LIMIT ORDER') || quotedText.includes('PENDING') || quotedText.includes('Limit Order set');
        const initialStatus = isLimit ? 'pending' : 'active';

        await db.saveTrade({
            userJid: m.sender,
            coin, type, direction, entry, tp, tp1, sl, rrr,
            status: initialStatus
        });

        const statusMsg = isLimit 
            ? `⏳ *Pending Order:* Market එක $${entry} වෙත පැමිණි පසු Trade එක Auto-Active වනු ඇත.` 
            : `🟢 *Active Order:* Trade එක දැන් සිටම Track වේ.`;

        await reply(`✅ *Trade Successfully Tracked!*\n\n🪙 ${coin} (${type.toUpperCase()} | ${direction})\n🎯 Entry: $${entry}\n💰 TP: $${tp}\n🛑 SL: $${sl}\n\n${statusMsg}`);
        await m.react('✅');
    } catch (e) {
        await reply('❌ Error: ' + e.message);
    }
});
