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
        if (!m.quoted) return await reply('❌ AI Analysis message ලෙ Reply කරමින් .track යවන්න.');

        const quotedText = m.quoted.conversation || m.quoted.extendedTextMessage?.text || m.quoted.text || m.quoted.body || "";
        if (!quotedText) return await reply('❌ Quoted message කියවීමට නොහැකිය.');

        const coinMatch = quotedText.match(/🪙 ([A-Z]+)\s*\/\s*USDT/);
        if (!coinMatch) return await reply('❌ නිවැරදි Analysis message නොවේ.');
        const coin = coinMatch[1] + 'USDT';
        const type = quotedText.includes('SPOT') ? 'spot' : 'future';

        // ✅ Entry, TP1, TP2(main), SL parse
        const targetMatch = quotedText.match(/\[TARGETS\|ENTRY:\s*([0-9.]+)\s*\|TP:\s*([0-9.]+)\s*\|SL:\s*([0-9.]+)\s*\]/);
        if (!targetMatch) return await reply('❌ Entry/TP/SL data නොමැත.');

        const entry = parseFloat(targetMatch[1]);
        const tp    = parseFloat(targetMatch[2]);
        const sl    = parseFloat(targetMatch[3]);

        // ✅ TP1 parse (Partial TP)
        const tp1Match = quotedText.match(/TP1.*?:\s*\$([0-9,.]+)/);
        const tp1 = tp1Match ? parseFloat(tp1Match[1].replace(/,/g, '')) : null;

        // ✅ Direction parse
        const dirMatch = quotedText.match(/Direction.*?(LONG|SHORT|BUY)/);
        const direction = dirMatch ? (dirMatch[1] === 'BUY' ? 'LONG' : dirMatch[1]) : 'LONG';

        // ✅ RRR parse
        const rrrMatch = quotedText.match(/RRR.*?1:([\d.]+)/);
        const rrr = rrrMatch ? `1:${rrrMatch[1]}` : 'N/A';

        await db.saveTrade({
            userJid: m.sender,
            coin, type, direction, entry, tp, tp1, sl, rrr
        });

        await reply(`✅ *${coin}* Trade Track ආරම්භ!

📍 Entry: $${entry}
🎯 TP1 (50%): ${tp1 ? '$' + tp1 : 'N/A'}
🎯 TP2 (50%): $${tp}
🛡️ SL: $${sl}
📊 Direction: ${direction} | RRR: ${rrr}

_TP1 hit ලෙ partial close alert ලැබේ._
_TP2/SL hit ලෙ Journal ලෙ auto record වෙයි._`);
        await m.react('✅');
    } catch (e) { await reply('❌ Error: ' + e.message); }
});