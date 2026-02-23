const { cmd } = require('../lib/commands');
const config = require('../config');
const binance = require('../lib/binance');
const indicators = require('../lib/indicators');
const smc = require('../lib/smartmoney');

cmd({
    pattern: "backtest",
    desc: "Test Long & Short strategy on last 1000 candles",
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
        await reply(`⏳ *${coin} හි දියුණු අතීත දත්ත පරීක්ෂාව (Backtesting) ආරම්භ කෙරේ...*\n(Long සහ Short අවස්ථා දෙකම පරීක්ෂා වේ)`);

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

        for (let i = 100; i < candles.length - 20; i++) {
            let historySlice = candles.slice(i - 100, i);
            let currentPrice = parseFloat(historySlice[historySlice.length - 1][4]);
            
            let rsi = parseFloat(indicators.calculateRSI(historySlice));
            let atr = parseFloat(indicators.calculateATR(historySlice));
            let ema50 = parseFloat(indicators.calculateEMA(historySlice, 50));
            
            let marketSMC = smc.analyzeSMC(historySlice);
            let fib618 = parseFloat(marketSMC.fib618);
            let res = parseFloat(marketSMC.resistance);
            let sup = parseFloat(marketSMC.support);

            // 🟢 LONG STRATEGY: මිල EMA50 ට වඩා උඩින්, Fib 618 කිට්ටුව, RSI < 45
            let isLong = currentPrice > ema50 && Math.abs(currentPrice - fib618) / fib618 < 0.003 && rsi < 45;
            
            // 🔴 SHORT STRATEGY: මිල EMA50 ට වඩා පහළින්, Resistance කිට්ටුව, RSI > 55
            let isShort = currentPrice < ema50 && Math.abs(currentPrice - res) / res < 0.003 && rsi > 55;

            if (isLong || isShort) {
                totalTrades++;
                let entryPrice = currentPrice;
                let tp, sl;

                if (isLong) {
                    longTrades++;
                    tp = entryPrice + (atr * 3); // RRR 1:1.5
                    sl = entryPrice - (atr * 2);
                } else {
                    shortTrades++;
                    tp = entryPrice - (atr * 3); // RRR 1:1.5
                    sl = entryPrice + (atr * 2);
                }
                
                let tradeWon = false;
                for (let j = i + 1; j < i + 20 && j < candles.length; j++) {
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
                i += 10; // Trade එකෙන් පස්සේ කැන්ඩල් 10ක් මඟහරින්න
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
