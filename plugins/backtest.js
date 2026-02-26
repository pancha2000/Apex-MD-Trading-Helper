const { cmd } = require('../lib/commands');
const config = require('../config');
const binance = require('../lib/binance');
const indicators = require('../lib/indicators');
const smc = require('../lib/smartmoney');

cmd({
    pattern: "backtest",
    desc: "Advanced Institutional SMC + Harmonic Backtester",
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
        await reply(`⏳ *${coin} හි "Institutional SMC + Harmonic" Backtest ආරම්භ කෙරේ...*\n(කරුණාකර රැඳී සිටින්න. සංකීර්ණ ගණනය කිරීම් හේතුවෙන් මෙය තත්පර කිහිපයක් ගතවිය හැක ⚙️)`);

        let candles;
        try {
            candles = await binance.getKlineData(coin, timeframe, 1000);
        } catch (err) {
            return await reply("❌ Binance දත්ත ලබාගැනීමට නොහැකි විය.");
        }

        if (!candles || candles.length < 500) return await reply("❌ ප්‍රමාණවත් දත්ත නොමැත (අවම 500ක් අවශ්‍යයි).");

        let totalTrades = 0, wins = 0, losses = 0, longTrades = 0, shortTrades = 0;
        let maxConsecutiveLoss = 0, currLoss = 0;

        // Loop through historical candles
        let i = 200; // Start from 200 to have enough history for EMA200
        while (i < candles.length - 10) {
            let slice = candles.slice(i - 100, i); 
            let currentPrice = parseFloat(slice[slice.length - 1][4]);

            // Indicators Calculation for current step
            let ema200 = parseFloat(indicators.calculateEMA(candles.slice(i - 200, i), 200));
            let ema50 = parseFloat(indicators.calculateEMA(slice, 50));
            let rsi = indicators.calculateRSI(slice.slice(-50), 14);
            let atr = parseFloat(indicators.calculateATR(slice.slice(-50), 14));
            
            // Advanced SMC & Pattern Calculation
            let marketSMC = smc.analyzeSMC(slice.slice(-50));
            let harmonicPattern = indicators.checkHarmonicPattern(slice);
            let ictSilverBullet = indicators.checkICTSilverBullet(slice.slice(-10));

            let longScore = 0, shortScore = 0;

            // 1. Trend Filter
            if (currentPrice > ema200) longScore++;
            if (currentPrice < ema200) shortScore++;

            // 2. EMA Pullback
            let diffFromEma50 = Math.abs(currentPrice - ema50) / ema50;
            if (currentPrice > ema200 && diffFromEma50 < 0.005) longScore++;
            if (currentPrice < ema200 && diffFromEma50 < 0.005) shortScore++;

            // 3. SMC Order Blocks
            if (marketSMC.bullishOB) longScore++;
            if (marketSMC.bearishOB) shortScore++;

            // 4. RSI Threshold
            if (rsi < 45) longScore++;
            if (rsi > 55) shortScore++;

            // 5. Liquidity Sweep / ChoCH
            if (marketSMC.sweep.includes("Bullish") || marketSMC.choch.includes("Bullish")) longScore++;
            if (marketSMC.sweep.includes("Bearish") || marketSMC.choch.includes("Bearish")) shortScore++;

            // 6. Harmonic Patterns (VIP Factor - Gets 2 Points)
            if (harmonicPattern.includes("Bullish")) longScore += 2; 
            if (harmonicPattern.includes("Bearish")) shortScore += 2;

            // 7. ICT Silver Bullet
            if (ictSilverBullet.includes("Bullish")) longScore++;
            if (ictSilverBullet.includes("Bearish")) shortScore++;

            let tradeTaken = false;
            let isLong = false;

            // Execution Threshold
            if (longScore >= 4) { tradeTaken = true; isLong = true; longTrades++; }
            else if (shortScore >= 4) { tradeTaken = true; isLong = false; shortTrades++; }

            if (tradeTaken) {
                totalTrades++;
                let entry = currentPrice;
                let sl, tp;

                // Smart ATR based TP/SL
                if (isLong) {
                    sl = entry - (atr * 1.5);
                    tp = entry + (atr * 2.5); // RRR ~ 1:1.6
                } else {
                    sl = entry + (atr * 1.5);
                    tp = entry - (atr * 2.5);
                }

                // Forward test to check trade outcome
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
                i += 10; // Jump 10 candles forward after a trade
            } else {
                i++; // Move to next candle
            }
        }

        let winRate = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(2) : 0;
        let profitFactor = losses > 0 ? ((wins * 2.5) / (losses * 1.5)).toFixed(2) : "∞";

        const outMsg = `
╔═══════════════════════════╗
║ 🎯 *INSTITUTIONAL BACKTEST* ║
╚═══════════════════════════╝

🪙 Coin: #${coin.replace('USDT', '')} / USDT
⏱️ Timeframe: ${timeframe}
📊 Analyzed: 1000 candles

*🧠 Strategy Matrix Used:*
▫️ SMC (Order Blocks, Sweeps, ChoCH)
▫️ Harmonic Patterns (Gartley, Bat)
▫️ ICT Silver Bullet
▫️ Trend & Pullbacks

*🎯 Performance Results:*
▫️ Total Trades: ${totalTrades} (Long: ${longTrades} | Short: ${shortTrades})
🟢 Wins (TP Hit): ${wins}
🔴 Losses (SL Hit): ${losses}

🏆 *Win Rate: ${winRate}%*
📈 Profit Factor: ${profitFactor} (>1.5 = Superb)
⚠️ Max Consecutive Loss: ${maxConsecutiveLoss}

💡 _මෙම ප්‍රතිඵල මගින් අතීත දත්ත මත පදනම්ව AI හි සාර්ථකත්වය පෙන්වයි._`;

        await reply(outMsg.trim());
        await m.react('✅');
    } catch (err) {
        await reply('❌ Error: ' + err.message);
    }
});
