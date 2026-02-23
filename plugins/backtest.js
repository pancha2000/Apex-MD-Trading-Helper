const { cmd } = require('../lib/commands');
const config = require('../config');
const binance = require('../lib/binance');
const indicators = require('../lib/indicators');

cmd({
    pattern: "backtest",
    desc: "Sniper Strategy (EMA 200 + Pullback)",
    category: "crypto",
    react: "⏪",
    filename: __filename
},
async (conn, mek, m, { reply, args }) => {
    try {
        if (!args[0]) return await reply(`❌ කරුණාකර Coin එකක් ලබා දෙන්න!\n*උදා:* ${config.PREFIX}backtest BTC 15m`);
        
        let coin = args[0].toUpperCase();
        if (!coin.endsWith('USDT')) coin += 'USDT';
        let timeframe = args[1] ? args[1].toLowerCase() : '15m'; 

        await m.react('⏳');
        await reply(`⏳ *${coin} හි "Sniper" අතීත දත්ත පරීක්ෂාව ආරම්භ කෙරේ...*\n(EMA 200 සහ Momentum ෆිල්ටරය සහිතව)`);

        let candles;
        try {
            candles = await binance.getKlineData(coin, timeframe, 1000);
        } catch (err) {
            return await reply("❌ Binance වෙතින් දත්ත ලබාගැනීමට නොහැකි විය.");
        }

        if (!candles || candles.length < 500) return await reply("❌ පරීක්ෂා කිරීමට ප්‍රමාණවත් අතීත දත්ත නොමැත.");

        let totalTrades = 0, wins = 0, losses = 0, longTrades = 0, shortTrades = 0;

        for (let i = 200; i < candles.length - 30; i++) {
            let historySlice = candles.slice(i - 200, i); // EMA 200 ගණනයට කැන්ඩල්ස් 200 ක් ඕනේ
            let lastCandle = historySlice[historySlice.length - 1];
            let currentPrice = parseFloat(lastCandle[4]);
            let currentLow = parseFloat(lastCandle[3]);
            let currentHigh = parseFloat(lastCandle[2]);
            
            let rsi = parseFloat(indicators.calculateRSI(historySlice.slice(-50)));
            let atr = parseFloat(indicators.calculateATR(historySlice.slice(-50)));
            let ema50 = parseFloat(indicators.calculateEMA(historySlice.slice(-50), 50));
            let ema200 = parseFloat(indicators.calculateEMA(historySlice, 200)); // 👈 Ultimate Trend Filter

            if (!ema200 || !ema50) continue;

            // 🟢 SNIPER LONG: මිල EMA200 ට වඩා ගොඩක් උඩින්, EMA50 ට Pullback වෙනවා, RSI එක 45ට අඩුයි.
            let isLong = currentPrice > ema200 && currentPrice > ema50 && currentLow <= (ema50 * 1.002) && rsi < 45;
            
            // 🔴 SNIPER SHORT: මිල EMA200 ට වඩා ගොඩක් පල්ලෙහායින්, EMA50 ට Pullback වෙනවා, RSI එක 55ට වැඩියි.
            let isShort = currentPrice < ema200 && currentPrice < ema50 && currentHigh >= (ema50 * 0.998) && rsi > 55;

            if (isLong || isShort) {
                totalTrades++;
                let entryPrice = currentPrice;
                let tp, sl;

                if (isLong) {
                    longTrades++;
                    tp = entryPrice + (atr * 2.5); 
                    sl = entryPrice - (atr * 1.5);
                } else {
                    shortTrades++;
                    tp = entryPrice - (atr * 2.5); 
                    sl = entryPrice + (atr * 1.5);
                }
                
                let tradeWon = false;
                for (let j = i + 1; j < i + 30 && j < candles.length; j++) {
                    let futureHigh = parseFloat(candles[j][2]);
                    let futureLow = parseFloat(candles[j][3]);

                    if (isLong) {
                        if (futureLow <= sl) { losses++; break; }
                        if (futureHigh >= tp) { wins++; tradeWon = true; break; }
                    } else {
                        if (futureHigh >= sl) { losses++; break; }
                        if (futureLow <= tp) { wins++; tradeWon = true; break; }
                    }
                }
                i += 15; // Trade එකෙන් පස්සේ කැන්ඩල්ස් 15ක් පනිනවා
            }
        }

        let winRate = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(2) : 0;

        const outMsg = `
╔═══════════════════════════╗
║ 🎯 *SNIPER BACKTEST RESULTS* ║
╚═══════════════════════════╝

🪙 Coin: #${coin.replace('USDT', '')} / USDT
⏱️ Timeframe: ${timeframe}
📊 පරීක්ෂා කළ කැන්ඩල්ස්: 1000

*🎯 Strategy Performance:*
▫️ මුළු Trades ගණන: ${totalTrades} (Long: ${longTrades} | Short: ${shortTrades})
🟢 ජයග්‍රහණ (TP Hit): ${wins}
🔴 පරාජයන් (SL Hit): ${losses}

🏆 *Win Rate: ${winRate}%*

⚡ *නිගමනය:*
${winRate >= 60 ? "✅ මෙම Strategy එක ඉතා සාර්ථකයි! (High Profit)" : winRate >= 45 ? "⚠️ මධ්‍යම මට්ටමේ සාර්ථකත්වයක්. AI ෆිල්ටරය අනිවාර්යයි." : "❌ මෙහි Win Rate එක අඩුය."}
`;
        await reply(outMsg.trim());
        await m.react('✅');

    } catch (e) { await reply('❌ Error: ' + e.message); }
});
