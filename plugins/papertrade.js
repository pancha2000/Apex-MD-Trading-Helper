const { cmd } = require('../lib/commands');
const db = require('../lib/database');
const config = require('../config');

// ─── 1. PAPER TRADING MENU & TOGGLE ───
cmd({
    pattern: "paper",
    desc: "Paper Trading Menu & Toggle",
    category: "crypto",
    react: "📝",
    filename: __filename
},
async (conn, mek, m, { reply, args }) => {
    try {
        const settings = await db.getSettings();
        
        if (!args[0]) {
            // Show Paper Trading Menu
            const statusStr = settings.paperTrade ? "🟢 ON" : "🔴 OFF";
            const menu = `
╔═══════════════════════════╗
║ 📝 *AUTO PAPER TRADING* ║
╚═══════════════════════════╝

*Status:* ${statusStr}
*Min Score:* ${settings.paperMinScore}/14

*🛠️ Commands:*
▫️ \`.paper on\` - Auto Paper Trading සක්‍රිය කරන්න.
▫️ \`.paper off\` - Auto Paper Trading අක්‍රිය කරන්න.
▫️ \`.paperscore <1-14>\` - Trade එකක් Auto වැටෙන්න ඕනේ අවම ලකුණු ගාණ වෙනස් කරන්න.
▫️ \`.paperstats\` - ඔබේ බොරු මුදල් ශේෂය (Virtual Balance) සහ ලාභ/පාඩු බලන්න.
▫️ \`.paperreset\` - ශේෂය නැවත $100 ට Reset කරන්න.

_💡 මේ හරහා ඔබට කිසිදු අවදානමකින් තොරව බොට්ගේ සාර්ථකත්වය සැබෑ වෙළඳපොළේ (Real-time) පරීක්ෂා කළ හැක._`;
            return await reply(menu.trim());
        }

        const action = args[0].toLowerCase();
        if (action === 'on') {
            await db.updateSettings({ paperTrade: true });
            await reply("✅ *Auto Paper Trading සක්‍රිය කරන ලදී!* \nමීළඟට Scanner එකට අසුවන හොඳම Trades, ඔබේ Virtual Balance එක භාවිතා කර ස්වයංක්‍රීයව දමනු ඇත.");
        } else if (action === 'off') {
            await db.updateSettings({ paperTrade: false });
            await reply("🛑 *Auto Paper Trading අක්‍රිය කරන ලදී!*");
        } else {
            await reply("❌ වැරදි කමාන්ඩ් එකක්! මෙනුව බැලීමට `.paper` පමණක් යොදන්න.");
        }
    } catch (e) { await reply('❌ Error: ' + e.message); }
});

// ─── 2. SET MINIMUM SCORE FOR PAPER TRADE ───
cmd({
    pattern: "paperscore",
    desc: "Set min score for paper trades",
    category: "crypto",
    react: "⚙️",
    filename: __filename
},
async (conn, mek, m, { reply, args }) => {
    try {
        if (!args[0] || isNaN(args[0])) return await reply("❌ කරුණාකර ලකුණු ගණන ලබා දෙන්න! (උදා: .paperscore 6)");
        const score = parseInt(args[0]);
        if (score < 1 || score > 14) return await reply("❌ ලකුණු ගණන 1 ත් 14 ත් අතර විය යුතුය.");

        await db.updateSettings({ paperMinScore: score });
        await reply(`✅ *Paper Trade Min Score යාවත්කාලීන කරන ලදී!*\nදැන් ලකුණු ${score}/14 හෝ ඊට වැඩි Trades පමණක් Auto දමනු ඇත.`);
    } catch (e) { await reply('❌ Error: ' + e.message); }
});

// ─── 3. PAPER TRADE STATS (Virtual Balance & PnL) ───
cmd({
    pattern: "paperstats",
    alias: ["pstats"],
    desc: "Check Virtual Balance and Win Rate",
    category: "crypto",
    react: "📊",
    filename: __filename
},
async (conn, mek, m, { reply }) => {
    try {
        const user = await db.getUser(m.sender);
        
        const winRate = user.paperTrades > 0 ? ((user.paperWins / user.paperTrades) * 100).toFixed(2) : 0;
        const balanceProfit = user.paperBalance - 100;
        const profitEmoji = balanceProfit >= 0 ? "📈" : "📉";
        const profitSign = balanceProfit >= 0 ? "+" : "";

        const statsStr = `
╔═══════════════════════════╗
║ 📊 *PAPER TRADING STATS* ║
╚═══════════════════════════╝

💰 *Virtual Balance: $${user.paperBalance.toFixed(2)}*
${profitEmoji} Net Profit: ${profitSign}$${balanceProfit.toFixed(2)}

*🎯 Performance:*
▫️ Total Auto Trades: ${user.paperTrades}
🟢 Wins: ${user.paperWins}
🔴 Losses: ${user.paperLosses}
🏆 Win Rate: ${winRate}%

_💡 ඉහළ Win Rate එකක් පවත්වා ගැනීමට \`.paperscore 6\` හෝ ඊට වැඩි අගයක් භාවිතා කිරීම නිර්දේශ කෙරේ._`;

        await reply(statsStr.trim());
    } catch (e) { await reply('❌ Error: ' + e.message); }
});

// ─── 4. RESET VIRTUAL BALANCE ───
cmd({
    pattern: "paperreset",
    desc: "Reset paper balance to $100",
    category: "crypto",
    react: "🔄",
    filename: __filename
},
async (conn, mek, m, { reply }) => {
    try {
        await db.connect();
        const user = await db.User.findOne({ jid: m.sender });
        
        if (user) {
            user.paperBalance = 100;
            user.paperTrades = 0;
            user.paperWins = 0;
            user.paperLosses = 0;
            await user.save();
            await reply("🔄 *ඔබේ Paper Trading ගිණුම සාර්ථකව Reset කරන ලදී!*\nනව Virtual Balance එක: $100.00");
        }
    } catch (e) { await reply('❌ Error: ' + e.message); }
});
const { cmd } = require('../lib/commands');
const db = require('../lib/database');
const config = require('../config');

// ─── 1. PAPER TRADING MENU & TOGGLE ───
cmd({
    pattern: "paper",
    desc: "Paper Trading Menu & Toggle",
    category: "crypto",
    react: "📝",
    filename: __filename
},
async (conn, mek, m, { reply, args }) => {
    try {
        const settings = await db.getSettings();
        
        if (!args[0]) {
            // Show Paper Trading Menu
            const statusStr = settings.paperTrade ? "🟢 ON" : "🔴 OFF";
            const menu = `
╔═══════════════════════════╗
║ 📝 *AUTO PAPER TRADING* ║
╚═══════════════════════════╝

*Status:* ${statusStr}
*Min Score:* ${settings.paperMinScore}/14

*🛠️ Commands:*
▫️ \`.paper on\` - Auto Paper Trading සක්‍රිය කරන්න.
▫️ \`.paper off\` - Auto Paper Trading අක්‍රිය කරන්න.
▫️ \`.paperscore <1-14>\` - Trade එකක් Auto වැටෙන්න ඕනේ අවම ලකුණු ගාණ වෙනස් කරන්න.
▫️ \`.paperstats\` - ඔබේ බොරු මුදල් ශේෂය (Virtual Balance) සහ ලාභ/පාඩු බලන්න.
▫️ \`.paperreset\` - ශේෂය නැවත $100 ට Reset කරන්න.

_💡 මේ හරහා ඔබට කිසිදු අවදානමකින් තොරව බොට්ගේ සාර්ථකත්වය සැබෑ වෙළඳපොළේ (Real-time) පරීක්ෂා කළ හැක._`;
            return await reply(menu.trim());
        }

        const action = args[0].toLowerCase();
        if (action === 'on') {
            await db.updateSettings({ paperTrade: true });
            await reply("✅ *Auto Paper Trading සක්‍රිය කරන ලදී!* \nමීළඟට Scanner එකට අසුවන හොඳම Trades, ඔබේ Virtual Balance එක භාවිතා කර ස්වයංක්‍රීයව දමනු ඇත.");
        } else if (action === 'off') {
            await db.updateSettings({ paperTrade: false });
            await reply("🛑 *Auto Paper Trading අක්‍රිය කරන ලදී!*");
        } else {
            await reply("❌ වැරදි කමාන්ඩ් එකක්! මෙනුව බැලීමට `.paper` පමණක් යොදන්න.");
        }
    } catch (e) { await reply('❌ Error: ' + e.message); }
});

// ─── 2. SET MINIMUM SCORE FOR PAPER TRADE ───
cmd({
    pattern: "paperscore",
    desc: "Set min score for paper trades",
    category: "crypto",
    react: "⚙️",
    filename: __filename
},
async (conn, mek, m, { reply, args }) => {
    try {
        if (!args[0] || isNaN(args[0])) return await reply("❌ කරුණාකර ලකුණු ගණන ලබා දෙන්න! (උදා: .paperscore 6)");
        const score = parseInt(args[0]);
        if (score < 1 || score > 14) return await reply("❌ ලකුණු ගණන 1 ත් 14 ත් අතර විය යුතුය.");

        await db.updateSettings({ paperMinScore: score });
        await reply(`✅ *Paper Trade Min Score යාවත්කාලීන කරන ලදී!*\nදැන් ලකුණු ${score}/14 හෝ ඊට වැඩි Trades පමණක් Auto දමනු ඇත.`);
    } catch (e) { await reply('❌ Error: ' + e.message); }
});

// ─── 3. PAPER TRADE STATS (Virtual Balance & PnL) ───
cmd({
    pattern: "paperstats",
    alias: ["pstats"],
    desc: "Check Virtual Balance and Win Rate",
    category: "crypto",
    react: "📊",
    filename: __filename
},
async (conn, mek, m, { reply }) => {
    try {
        const user = await db.getUser(m.sender);
        
        const winRate = user.paperTrades > 0 ? ((user.paperWins / user.paperTrades) * 100).toFixed(2) : 0;
        const balanceProfit = user.paperBalance - 100;
        const profitEmoji = balanceProfit >= 0 ? "📈" : "📉";
        const profitSign = balanceProfit >= 0 ? "+" : "";

        const statsStr = `
╔═══════════════════════════╗
║ 📊 *PAPER TRADING STATS* ║
╚═══════════════════════════╝

💰 *Virtual Balance: $${user.paperBalance.toFixed(2)}*
${profitEmoji} Net Profit: ${profitSign}$${balanceProfit.toFixed(2)}

*🎯 Performance:*
▫️ Total Auto Trades: ${user.paperTrades}
🟢 Wins: ${user.paperWins}
🔴 Losses: ${user.paperLosses}
🏆 Win Rate: ${winRate}%

_💡 ඉහළ Win Rate එකක් පවත්වා ගැනීමට \`.paperscore 6\` හෝ ඊට වැඩි අගයක් භාවිතා කිරීම නිර්දේශ කෙරේ._`;

        await reply(statsStr.trim());
    } catch (e) { await reply('❌ Error: ' + e.message); }
});

// ─── 4. RESET VIRTUAL BALANCE ───
cmd({
    pattern: "paperreset",
    desc: "Reset paper balance to $100",
    category: "crypto",
    react: "🔄",
    filename: __filename
},
async (conn, mek, m, { reply }) => {
    try {
        await db.connect();
        const user = await db.User.findOne({ jid: m.sender });
        
        if (user) {
            user.paperBalance = 100;
            user.paperTrades = 0;
            user.paperWins = 0;
            user.paperLosses = 0;
            await user.save();
            await reply("🔄 *ඔබේ Paper Trading ගිණුම සාර්ථකව Reset කරන ලදී!*\nනව Virtual Balance එක: $100.00");
        }
    } catch (e) { await reply('❌ Error: ' + e.message); }
});
