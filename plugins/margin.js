const { cmd } = require('../lib/commands');
const db = require('../lib/database'); // ඔයාගේ Database ෆයිල් එක

// ================== MARGIN COMMAND ==================
cmd({
    pattern: "margin",
    desc: "Set or update your trading margin/capital",
    category: "crypto",
    react: "💰",
    filename: __filename
},
async (conn, mek, m, { reply, args }) => {
    try {
        const userJid = m.sender;

        // මුකුත් නොගහා .margin විතරක් ගැහුවොත් දැනට තියෙන ගාණ පෙන්වීම
        if (!args[0]) {
            // Database එකෙන් Margin එක ගැනීම (DB එකේ getMargin කියලා function එකක් තියෙනවා යැයි උපකල්පනය කරමු)
            // ඔයාගේ DB ෆයිල් එකේ මේක නැත්නම් අපි ඒක ඊළඟට හදමු.
            let currentMargin = await db.getMargin(userJid) || 0; 
            return await reply(`🏦 *ඔබගේ දැනට පවතින Trading Margin එක:* $${currentMargin}\n\n🔄 අලුත් කිරීමට අවශ්‍ය නම්: \n*.margin 100* ලෙස යොදන්න.`);
        }

        const newMargin = parseFloat(args[0]);
        if (isNaN(newMargin) || newMargin <= 0) {
            return await reply('❌ කරුණාකර නිවැරදි මුදලක් ලබා දෙන්න. \nඋදා: .margin 50');
        }

        // අලුත් Margin එක Database එකේ Save කිරීම
        await db.saveMargin(userJid, newMargin);
        
        await reply(`✅ *Margin එක සාර්ථකව යාවත්කාලීන කරන ලදී!*\n\n💰 නව ප්‍රාග්ධනය: $${newMargin.toFixed(2)}\n\n(මීළඟට ඔබ AI විශ්ලේෂණයක් ගන්නා විට, මෙම මුදලට ගැලපෙන Position Size සහ Leverage ගණනය කර දෙනු ඇත.)`);
        await m.react('✅');

    } catch (e) {
        await reply('❌ Error: ' + e.message);
    }
});
