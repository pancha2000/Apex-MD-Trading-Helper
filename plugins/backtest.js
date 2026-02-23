const { cmd } = require('../lib/commands');
const config = require('../config');
const binance = require('../lib/binance');
const indicators = require('../lib/indicators');

cmd({
    pattern: "backtest",
    desc: "Test Pullback Strategy on last 1000 candles",
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
        await reply(`⏳ *${coin} හි යාවත්කාලීන කළ අතීත දත්ත පරීක්ෂාව ආරම්භ කෙරේ...*\n(කරුණාකර රැඳී සිටින්න)`);

        let candles;
        try {
            candles = await binance.getKlineData(coin, timeframe, 1000);
        } catch (err) {
            return await reply("❌ Binance වෙතින් දත්ත ලබාගැනීමට නොහැකි විය.");
        }

        if (!candles || candles.length < 500) {
            return await reply("❌ පරීක්ෂා කිරීමට ප්‍රමාණවත් අතීත දත්ත නොමැත.");
        }

        let totalTrades = 0, wins = 0, losses = 0, longTrades = 0, shortTrades = 0;

        for (let i = 100; i < candles.length - 30; i++) {
            let historySlice = candles.slice(i - 50, i);
            let lastCandle = historySlice[historySlice.length - 1];
            let currentPrice = parseFloat(lastCandle[4]);
            let currentLow = parseFloat(lastCandle[3]);
            let currentHigh = parseFloat(lastCandle[2]);
            
            let rsi = parseFloat(indicators.calculateRSI(historySlice));
            let atr = parseFloat(indicators.calculateATR(historySlice));
            let ema50 = parseFloat(indicators.calculateEMA(historySlice, 50));

            // 🟢 ලිහිල් කළ LONG නීතිය: Trend එක Up (මිල EMA50 ට උඩින්). හැබැයි මිල EMA50 ලයින් එකේ වැදුණොත් (Pullback) සහ RSI එක 50ට අඩු නම් BUY කරනවා!
            let isLong = currentPrice > ema50 && currentLow <= (ema50 * 1.002) && rsi < 50;
            
            // 🔴 ලිහිල් කළ SHORT නීතිය: Trend එක Down (මිල EMA50 ට පල්ලෙහායින්). හැබැයි මිල EMA50 ලයින් එකේ වැදුණොත් සහ RSI එක 50ට වැඩි නම් SELL කරනවා!
            let isShort = currentPrice < ema50 && currentHigh >= (ema50 * 0.998) && rsi > 50;

            if (isLong || isShort) {
                totalTrades++;
                let entryPrice = currentPrice;
                let tp, sl;

                // Risk to Reward Ratio (RRR) = 1:1.5
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
                // අනාගත කැන්ඩල්ස් 30ක් ඉස්සරහට චෙක් කරනවා
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
                i += 15; // Trade එකක් ගත්තට පස්සේ කැන්ඩල්ස් 15ක් මඟහරින්න (එකම තැන Trades 2ක් නොදාන්න)
            }
        }

        let winRate = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(2) : 0;

        const outMsg = `
╔═══════════════════════════╗
║ ⏪ *PRO BACKTEST RESULTS* ║
╚═══════════════════════════╝

🪙 Coin: #${coin.replace('USDT', '')} / USDT
⏱️ Timeframe: ${timeframe}
📊 පරීක්ෂා කළ කැන්ඩල්ස්: ${candles.length}

*🎯 Strategy Performance:*
▫️ මුළු Trades ගණන: ${totalTrades} (Long: ${longTrades} | Short: ${shortTrades})
🟢 ජයග්‍රහණ (TP Hit): ${wins}
🔴 පරාජයන් (SL Hit): ${losses}

🏆 *Win Rate: ${winRate}%*

⚡ *නිගමනය:*
${winRate >= 55 ? "✅ මෙම Strategy එක ඉතා සාර්ථකයි! (Profitable)" : winRate >= 40 ? "⚠️ මධ්‍යම මට්ටමේ සාර්ථකත්වයක්. AI ෆිල්ටරය අනිවාර්යයි." : "❌ මෙහි Win Rate එක අඩුය. AI තීරණ මත පමණක් රඳා පවතින්න."}
`;
        await reply(outMsg.trim());
        await m.react('✅');

    } catch (e) {
        await reply('❌ Error: Backtesting ක්‍රියාවලියේ දෝෂයක්. ' + e.message);
    }
});
