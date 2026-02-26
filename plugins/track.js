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

        // ✅ FIX 1: ඉමෝජි නොමැතිව වුවද කොයින් එක නිවැරදිව හඳුනාගැනීම
        const coinMatch = quotedText.match(/([A-Z]+)\s*\/\s*USDT/);
        
        if (!coinMatch) {
            if (quotedText.includes("⏳")) {
                return await reply('❌ කරුණාකර "⏳ Loading..." මැසේජ් එකට නොව, අවසාන Analysis Report එකට Reply කර .track යවන්න.');
            }
            return await reply('❌ නිවැරදි Analysis message එකක් නොවේ. (Coin එක සොයාගැනීමට නොහැක)');
        }
        
        const coin = coinMatch[1] + 'USDT';
        const type = quotedText.includes('SPOT') ? 'spot' : 'future';

        // ✅ Entry, TP1, TP2(main), SL parse
        const targetMatch = quotedText.match(/\[TARGETS\|ENTRY:\s*([0-9.]+)\s*\|TP:\s*([0-9.]+)\s*\|SL:\s*([0-9.]+)\s*\]/);
        if (!targetMatch) return await reply('❌ Entry/TP/SL data නොමැත. කරුණාකර සම්පූර්ණ රිපෝට් එකට reply කරන්න.');

        const entry = parseFloat(targetMatch[1]);
        const tp    = parseFloat(targetMatch[2]);
        const sl    = parseFloat(targetMatch[3]);

        // ✅ TP1 parse (Partial TP)
        const tp1Match = quotedText.match(/TP1.*?:\s*\$([0-9,.]+)/);
        const tp1 = tp1Match ? parseFloat(tp1Match[1].replace(/,/g, '')) : null;

        // ✅ FIX 2: Direction එක වඩාත් නිවැරදිව හඳුනාගැනීම
        const dirMatch = quotedText.match(/Smart Entry.*?([A-Z]+)/) || quotedText.match(/Direction.*?(LONG|SHORT|BUY)/);
        const direction = dirMatch ? (dirMatch[1] === 'BUY' ? 'LONG' : dirMatch[1]) : 'LONG';

        // ✅ RRR parse
        const rrrMatch = quotedText.match(/RRR.*?1:([\d.]+)/);
        const rrr = rrrMatch ? `1:${rrrMatch[1]}` : 'N/A';

        // ✅ Limit Order ද Market Order ද යන්න හඳුනාගැනීම
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

        await reply(`✅ *${coin}* Trade Track ආරම්භ!\n\n📍 Entry: $${entry}\n🎯 TP1: ${tp1 ? '$' + tp1 : 'N/A'}\n🎯 TP2: $${tp}\n🛡️ SL: $${sl}\n📊 Direction: ${direction}\n\n${statusMsg}`);
        await m.react('✅');
    } catch (e) { await reply('❌ Error: ' + e.message); }
});
