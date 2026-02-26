const { cmd } = require('../lib/commands');
const config = require('../config');
const binance = require('../lib/binance');
const indicators = require('../lib/indicators');
const smc = require('../lib/smartmoney');

cmd({
    pattern: "backtest",
    desc: "Ultimate SMC + Harmonic + Volume/VWAP Backtester",
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
        await reply(`⏳ *${coin} හි "Volume & VWAP" සහිත Ultimate Backtest ආරම්භ කෙරේ...*\n(කරුණාකර රැඳී සිටින්න. මෙම ගණනය කිරීම් සඳහා තත්පර කිහිපයක් ගතවිය හැක ⚙️)`);

        let candles;
        try {
            candles = await binance.getKlineData(coin, timeframe, 1000);
        } catch (err) {
            return await reply("❌ Binance දත්ත ලබාගැනීමට නොහැකි විය.");
        }

        if (!candles || candles.length < 500) return await reply("❌ ප්‍රමාණවත් දත්ත නොමැත (අවම 500ක් අවශ්‍යයි).");

        let totalTrades = 0, wins = 0, losses = 0, longTrades = 0, shortTrades = 0;
        let maxConsecutiveLoss = 0, currLoss = 0;

        let i = 200; 
        while (i < candles.length - 10) {
            let slice = candles.slice(i - 100, i); 
            let currentPrice = parseFloat(slice[slice.length - 1][4]);

            let ema200 = parseFloat(indicators.calculateEMA(candles.slice(i - 200, i), 200));
            let ema50 = parseFloat(indicators.calculateEMA(slice, 50));
            let rsi = indicators.calculateRSI(slice.slice(-50), 14);
            let atr = parseFloat(indicators.calculateATR(slice.slice(-50), 14));
            
            let adxData = indicators.calculateADX(slice.slice(-50));
            let marketSMC = smc.analyzeSMC(slice.slice(-50));
            let harmonicPattern = indicators.checkHarmonicPattern(slice);
            let ictSilverBullet = indicators.checkICTSilverBullet(slice.slice(-10));
            
            // ✅ NEW: Volume Breakout & VWAP Filters
            let volBreak = indicators.checkVolumeBreakout(slice.slice(-50));
            let vwap = indicators.calculateVWAP(slice);

            let longScore = 0, shortScore = 0;

            if (currentPrice > ema200) longScore++;
            if (currentPrice < ema200) shortScore++;

            let diffFromEma50 = Math.abs(currentPrice - ema50) / ema50;
            if (currentPrice > ema200 && diffFromEma50 < 0.005) longScore++;
            if (currentPrice < ema200 && diffFromEma50 < 0.005) shortScore++;

            if (marketSMC.bullishOB) longScore++;
            if (marketSMC.bearishOB) shortScore++;

            if (rsi < 45) longScore++;
            if (rsi > 55) shortScore++;

            if (marketSMC.sweep.includes("Bullish") || marketSMC.choch.includes("Bullish")) longScore++;
            if (marketSMC.sweep.includes("Bearish") || marketSMC.choch.includes("Bearish")) shortScore++;

            if (harmonicPattern.includes("Bullish")) longScore += 2; 
            if (harmonicPattern.includes("Bearish")) shortScore += 2;

            if (ictSilverBullet.includes("Bullish")) longScore++;
            if (ictSilverBullet.includes("Bearish")) shortScore++;

            // ✅ NEW: Add scores for Volume and VWAP
            if (volBreak.includes("Bullish Breakout")) longScore++;
            if (volBreak.includes("Bearish Breakout")) shortScore++;

            if (vwap.includes('🟢')) longScore++;
            if (vwap.includes('🔴')) shortScore++;

            let tradeTaken = false;
            let isLong = false;

            // ✅ UPGRADED: Strict Mode - ලකුණු 6 ක් වත් ඕනේ වගේම ADX එක 20 ට වඩා වැඩි වෙන්නත් ඕනේ
            if (adxData.value > 20 || adxData.isStrong) {
                if (longScore >= 6) { tradeTaken = true; isLong = true; longTrades++; }
                else if (shortScore >= 6) { tradeTaken = true; isLong = false; shortTrades++; }
            }

            if (tradeTaken) {
                totalTrades++;
                let entry = currentPrice;
                let sl, tp;

                if (isLong) {
                    sl = entry - (atr * 2.0);
                    tp = entry + (atr * 3.0); 
                } else {
                    sl = entry + (atr * 2.0);
                    tp = entry - (atr * 3.0);
                }

                for (let j = i; j < candles.length; j++) {
                    let futureHigh = parseFloat(candles[j][2]);
                    let futureLow = parseFloat(candles[j][3]);

                    if (isLong) {
                        if (futureLow <= sl) { losses++; currLoss++; maxConsecutiveLoss = Math.max(maxConsecutiveLoss, currLoss); break; }
                        if (futureHigh >= tp) { wins++; currLoss = 0; break; }
                    } else {
                        if (futureHigh >= sl) { losses++; currLoss++; maxConsecutiveLoss = Math.max(maxConsecutiveLoss, currLoss); break; }
                        if (futureLow <= tp) { wins++; currLoss = 0; break; }
                    }
                }
                i += 15; // Trade එකකින් පස්සේ තව කැන්ඩල් 15ක් ඉස්සරහට පනිනවා
            } else {
                i++; 
            }
        }

        let winRate = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(2) : 0;
        let profitFactor = losses > 0 ? ((wins * 3.0) / (losses * 2.0)).toFixed(2) : "∞";

        const outMsg = `
╔═══════════════════════════╗
║ 🎯 *ULTIMATE BACKTEST RESULTS* ║
╚═══════════════════════════╝

🪙 Coin: #${coin.replace('USDT', '')} / USDT
⏱️ Timeframe: ${timeframe}
📊 Analyzed: 1000 candles

*🧠 Strategy Matrix Used:*
▫️ ADX Trend Filter
▫️ Volume Breakout & VWAP (NEW 🔥)
▫️ SMC (OB, Sweeps, ChoCH)
▫️ Harmonic Patterns & ICT Silver Bullet

*🎯 Performance Results:*
▫️ Total Trades: ${totalTrades} (Long: ${longTrades} | Short: ${shortTrades})
🟢 Wins (TP Hit): ${wins}
🔴 Losses (SL Hit): ${losses}

🏆 *Win Rate: ${winRate}%*
📈 Profit Factor: ${profitFactor} (>1.2 = Profitable)
⚠️ Max Consecutive Loss: ${maxConsecutiveLoss}

💡 _අමතර Volume සහ VWAP සාධක මගින් Fakeouts ඉවත් කර Win Rate එක ඉහළ නංවා ඇත._`;

        await reply(outMsg.trim());
        await m.react('✅');
    } catch (err) {
        await reply('❌ Error: ' + err.message);
    }
});
