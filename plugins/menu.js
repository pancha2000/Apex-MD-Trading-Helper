const { cmd } = require('../lib/commands');
const config = require('../config');
const { runtime } = require('../lib/functions');
const axios = require('axios');

cmd({
    pattern: 'menu',
    alias: ['help', 'start', 'list'],
    desc: 'Show main menu',
    category: 'main',
    react: '📈',
    filename: __filename
}, async (conn, mek, m, { reply }) => {
    try {
        const uptime = runtime(process.uptime());
        
        // Live header data
        let btcLine = 'N/A',
            fngLine = 'N/A';
        try {
            const [btcR, fngR] = await Promise.allSettled([
                axios.get('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT', { timeout: 4000 }),
                axios.get('https://api.alternative.me/fng/', { timeout: 4000 })
            ]);
            if (btcR.status === 'fulfilled') {
                const b = btcR.value.data;
                const chg = parseFloat(b.priceChangePercent);
                btcLine = `$${parseFloat(b.lastPrice).toLocaleString()} ${chg >= 0 ? '📈' : '📉'} ${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%`;
            }
            if (fngR.status === 'fulfilled') {
                const f = fngR.value.data.data[0];
                const v = parseInt(f.value);
                const e = v >= 75 ? '🤑' : v >= 55 ? '😊' : v >= 45 ? '😐' : v >= 25 ? '😨' : '😱';
                fngLine = `${e} ${v} — ${f.value_classification}`;
            }
        } catch (_) {}
        
        const P = config.PREFIX;
        const menu = `
╔══════════════════════════════╗
║  📈 *APEX-MD TRADING HELPER*  ║
╚══════════════════════════════╝

🤖 *${config.BOT_NAME}*
👤 Owner: ${config.OWNER_NAME}
⏱️ Uptime: ${uptime}
📖 Commands: ${P}info

₿ BTC: ${btcLine}
😱 Fear & Greed: ${fngLine}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 *ANALYSIS*
├ ${P}future BTC 15m  → Futures AI (17-factor)
├ ${P}spot ETH 4h     → Spot AI signal
├ ${P}backtest BTC 1h → Strategy backtest
├ ${P}chart BTC 15m   → Price chart
├ ${P}grid BTC        → Grid scalping zones
└ ${P}news            → News + sentiment

🤖 *PAPER TRADING* _(Virtual)_
├ ${P}paper           → Open trade (reply analysis)
├ ${P}myptrades       → Live P&L positions 🆕
├ ${P}closepaper BTC  → Close position 🆕
├ ${P}papercapital 500→ Set virtual balance
└ ${P}stats           → Performance journal

📋 *REAL TRADE TRACKING*
├ ${P}track           → Track trade (reply analysis)
├ ${P}mytrades        → All tracked trades
└ ${P}deltrade <ID>   → Delete trade

🔍 *SCANNER* _(Owner)_
├ ${P}scanstart       → Auto scanner ON
├ ${P}superscan       → Manual scan now
└ ${P}scanstop        → Auto scanner OFF

🔔 *ALERTS*
├ ${P}alert BTC 100000→ Price alert
├ ${P}myalerts        → View alerts
└ ${P}delalert <ID>   → Delete alert

👀 *WATCHLIST*
├ ${P}watch BTC ETH   → Add coins
├ ${P}wlcheck         → Live prices
└ ${P}unwatch BTC     → Remove

🧮 *TOOLS*
├ ${P}calc 100 95 120 → Risk calculator
└ ${P}margin 1000     → Set capital

⚙️ *SETTINGS* _(Owner)_
└ ${P}settings        → View & edit settings

━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📌 *QUICK START:*
1️⃣ *.margin 1000*      → Capital set කරන්න
2️⃣ *.future BTC 15m*   → Signal ගන්න
3️⃣ Reply + *.paper*    → Virtual trade open
4️⃣ *.myptrades*        → Live P&L බලන්න
5️⃣ *.scanstart*        → Auto mode ON

📖 *.info <command>* — Detail guide
   _Example: .info future | .info paper_

> _© ${config.BOT_NAME} ${new Date().getFullYear()}_`;
        
        await reply(menu.trim());
        await m.react('✅');
    } catch (e) {
        await reply('❌ Error: ' + e.message);
    }
});