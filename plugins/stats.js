const { cmd } = require('../lib/commands');
const db = require('../lib/database');
const config = require('../config');

// ═══════════════════════════════════════════════════════
// ✅ NEW: .stats - Trade Journal & Performance Stats
// ═══════════════════════════════════════════════════════
cmd({
    pattern: "stats",
    alias: ["journal", "performance"],
    desc: "Trade Journal & Performance Statistics",
    category: "crypto",
    react: "📊",
    filename: __filename
},
async (conn, mek, m, { reply }) => {
    try {
        await m.react('⏳');
        const stats = await db.getTradeStats(m.sender);

        if (!stats) return await reply('❌ Stats ලබාගැනීමේ දෝෂයක් ඇත.');
        if (stats.total === 0 && stats.active === 0) {
            return await reply(`📊 *TRADE JOURNAL*\n\nTrades නොමැත. ${config.PREFIX}future හෝ ${config.PREFIX}spot ලෙ signal ගෙන .track ලෙස track කරන්න.`);
        }

        const winEmoji  = stats.winRate >= 60 ? '🏆' : stats.winRate >= 50 ? '✅' : '⚠️';
        const pnlEmoji  = parseFloat(stats.totalPnl) >= 0 ? '📈' : '📉';
        const streakMsg = stats.currentStreak === 'WIN'
            ? `🔥 Current streak: WIN`
            : stats.currentStreak === 'LOSS'
            ? `❄️ Current streak: LOSS`
            : `➖ No streak`;

        // Win rate progress bar
        const barFilled = Math.round(stats.winRate / 10);
        const bar = '█'.repeat(barFilled) + '░'.repeat(10 - barFilled);

        let recentMsg = stats.recent.length > 0
            ? stats.recent.join('\n   ')
            : 'කිසිදු closed trade නොමැත.';

        const bestCoin  = stats.best?.coin  ? `${stats.best.coin} (+${(stats.best.pnlPct || 0).toFixed(1)}%)` : 'N/A';
        const worstCoin = stats.worst?.coin ? `${stats.worst.coin} (${(stats.worst.pnlPct || 0).toFixed(1)}%)` : 'N/A';

        const msg = `
╔═══════════════════════════╗
║  📊 *TRADE JOURNAL STATS* ║
╚═══════════════════════════╝

*👤 ඔබේ Trading Performance:*

📌 Active Trades: ${stats.active}
📁 Closed Trades: ${stats.total}
🟢 Wins:  ${stats.wins}   🔴 Losses: ${stats.losses}

${winEmoji} *Win Rate: ${stats.winRate}%*
[${bar}] ${stats.winRate}%

${pnlEmoji} *Total P&L: ${parseFloat(stats.totalPnl) >= 0 ? '+' : ''}${stats.totalPnl}%*
🏅 Best Trade:  ${bestCoin}
💀 Worst Trade: ${worstCoin}
🔥 Max Win Streak: ${stats.maxStreak}
${streakMsg}

*📋 Recent 5 Trades:*
   ${recentMsg}

> _${config.PREFIX}trades - Active trades ගැන_
> _${config.PREFIX}future BTC 15m - නව signal_`;

        await reply(msg.trim());
        await m.react('✅');
    } catch (e) { await reply('❌ Error: ' + e.message); }
});

// ═══════════════════════════════════════════════════════
// ✅ NEW: .resetstats - Clear trade history (Owner only)
// ═══════════════════════════════════════════════════════
cmd({
    pattern: "resetstats",
    desc: "Reset your trade journal history",
    category: "crypto",
    react: "🗑️",
    filename: __filename
},
async (conn, mek, m, { reply }) => {
    try {
        await db.Trade.deleteMany({ userJid: m.sender, status: 'closed' });
        await reply('✅ Trade journal history clear කරන ලදී!');
        await m.react('✅');
    } catch (e) { await reply('❌ Error: ' + e.message); }
});