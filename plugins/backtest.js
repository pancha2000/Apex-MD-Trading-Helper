const { cmd } = require('../lib/commands');
const config = require('../config');
const binance = require('../lib/binance');
const indicators = require('../lib/indicators');

cmd({
    pattern: "backtest",
    desc: "Sniper Strategy (EMA 200 + Pullback + Fixed RSI Thresholds)",
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
        await reply(`⏳ *${coin} හි "Sniper" Backtest ආරම්භ කෙරේ...*\n(EMA 200 + Wilder RSI + Volume Filter සහිතව)`);

        let candles;
        try {
            candles = await binance.getKlineData(coin, timeframe, 1000);
        } catch (err) {
            return await reply("❌ Binance දත්ත ලබාගැනීමට නොහැකි විය.");
        }

        if (!candles || candles.length < 500) return await reply("❌ ප්‍රමාණවත් දත්ත නොමැත.");

        let totalTrades = 0, wins = 0, losses = 0, longTrades = 0, shortTrades = 0;
        let consecutive = 0, maxConsecutiveLoss = 0, currLoss = 0;

        for (let i = 200; i < candles.length - 30; i++) {
            let historySlice = candles.slice(i - 200, i);
            let lastCandle = historySlice[historySlice.length - 1];
            let currentPrice = parseFloat(lastCandle[4]);
            let currentLow = parseFloat(lastCandle[3]);
            let currentHigh = parseFloat(lastCandle[2]);

            // ✅ FIX: නිවැරදි RSI - Wilder method (enough candles)
            let rsi = indicators.calculateRSI(historySlice.slice(-30), 14);
            let atr = parseFloat(indicators.calculateATR(historySlice.slice(-20), 14));
            let ema50 = parseFloat(indicators.calculateEMA(historySlice.slice(-100), 50));
            let ema200 = parseFloat(indicators.calculateEMA(historySlice, 200));
            let volBreak = indicators.checkVolumeBreakout(historySlice.slice(-30));

            if (!ema200 || !ema50 || !atr) continue;

            // ✅ FIX: RSI Thresholds & EMA Pullback Buffer Relaxed
            // Fakeout filter: volume breakout ගත් places skip
            let isFakeout = volBreak.includes("Fakeout");

            // Pullback කලාපය 0.5% දක්වා වැඩි කළා. RSI එක 50 මට්ටමට ගෙනාවා.
            let isLong = currentPrice > ema200 && currentPrice > ema50
                && currentLow <= (ema50 * 1.005) && rsi < 50 && !isFakeout;

            let isShort = currentPrice < ema200 && currentPrice < ema50
                && currentHigh >= (ema50 * 0.995) && rsi > 50 && !isFakeout;

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
                        if (futureLow <= sl) { losses++; currLoss++; maxConsecutiveLoss = Math.max(maxConsecutiveLoss, currLoss); break; }
                        if (futureHigh >= tp) { wins++; tradeWon = true; currLoss = 0; break; }
                    } else {
                        if (futureHigh >= sl) { losses++; currLoss++; maxConsecutiveLoss = Math.max(maxConsecutiveLoss, currLoss); break; }
                        if (futureLow <= tp) { wins++; tradeWon = true; currLoss = 0; break; }
                    }
                }
                i += 15;
            }
        }

        let winRate = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(2) : 0;
        // ✅ NEW: Profit Factor calculation
        let profitFactor = losses > 0 ? ((wins * 2.5) / (losses * 1.5)).toFixed(2) : "∞";

        const outMsg = `
╔═══════════════════════════╗
║ 🎯 *SNIPER BACKTEST RESULTS* ║
╚═══════════════════════════╝

🪙 Coin: #${coin.replace('USDT', '')} / USDT
⏱️ Timeframe: ${timeframe}
📊 Analyzed: 1000 candles

*🎯 Strategy Performance:*
▫️ Total Trades: ${totalTrades} (Long: ${longTrades} | Short: ${shortTrades})
🟢 Wins (TP Hit): ${wins}
🔴 Losses (SL Hit): ${losses}

🏆 *Win Rate: ${winRate}%*
📈 Profit Factor: ${profitFactor} (>1.5 = Good)
⚠️ Max Consecutive Loss: ${maxConsecutiveLoss}

*📌 Strategy Rules Used:*
▫️ Entry: Price > EMA200 + EMA50 Pullback (Relaxed to 0.5%)
▫️ RSI Threshold: Long <50 | Short >50
▫️ Fakeout Filter: Low Volume Breakout Skip
▫️ TP: ATR x2.5 | SL: ATR x1.5

⚡ *නිගමනය:*
${winRate >= 60 ? "✅ Strategy ඉතා සාර්ථකයි! (High Profit Zone)" : winRate >= 48 ? "⚠️ මධ්‍යම සාර්ථකත්වය. AI Filter අනිවාර්යයි." : "❌ Win Rate අඩුයි. Timeframe/Coin වෙනස් කරන්න."}
`;
        await reply(outMsg.trim());
        await m.react('✅');
    } catch (e) { await reply('❌ Error: ' + e.message); }
});
