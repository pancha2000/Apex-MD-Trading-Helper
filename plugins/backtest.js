const { cmd } = require('../lib/commands');
const config = require('../config');
const binance = require('../lib/binance');
const indicators = require('../lib/indicators');
const smc = require('../lib/smartmoney');

cmd({
    pattern: "backtest",
    desc: "Test strategy on last 1000 candles",
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
        await reply(`⏳ *${coin} හි අතීත දත්ත පරීක්ෂාව (Backtesting) ආරම්භ කෙරේ...*\n(මෙයට තත්පර කිහිපයක් ගතවනු ඇත)`);

        // Binance එකෙන් දත්ත ගැනීම (Error ආවොත් අල්ලගන්න)
        let candles;
        try {
            candles = await binance.getKlineData(coin, timeframe, 1000);
        } catch (err) {
            return await reply("❌ Binance වෙතින් දත්ත ලබාගැනීමට නොහැකි විය.");
        }

        if (!candles || candles.length < 500) {
            return await reply("❌ පරීක්ෂා කිරීමට ප්‍රමාණවත් අතීත දත්ත නොමැත.");
        }

        let totalTrades = 0;
        let wins = 0;
        let losses = 0;

        // කැන්ඩල්ස් 100 ඉඳන් 1000 වෙනකම් එකින් එක පරීක්ෂා කිරීම (Simulation)
        for (let i = 100; i < candles.length - 20; i++) {
            let historySlice = candles.slice(i - 100, i);
            let currentPrice = parseFloat(historySlice[historySlice.length - 1][4]);
            
            let rsi = parseFloat(indicators.calculateRSI(historySlice));
            let marketSMC = smc.analyzeSMC(historySlice);
            let fib618 = parseFloat(marketSMC.fib618);
            let swingLow = parseFloat(marketSMC.swingLow);
            let res = parseFloat(marketSMC.resistance);

            // Entry Condition (Golden Pocket + RSI)
            let diffPercent = Math.abs(currentPrice - fib618) / fib618 * 100;
            if (diffPercent < 0.3 && rsi < 40) { // RSI 40ට අඩු නම් (සාර්ථකත්වය වැඩියි)
                totalTrades++;
                let entryPrice = currentPrice;
                let tp = res; 
                let sl = swingLow * 0.998; 
                
                let tradeWon = false;
                for (let j = i + 1; j < i + 20 && j < candles.length; j++) {
                    let futureHigh = parseFloat(candles[j][2]);
                    let futureLow = parseFloat(candles[j][3]);

                    if (futureLow <= sl) {
                        losses++; 
                        break;
                    }
                    if (futureHigh >= tp) {
                        wins++; 
                        tradeWon = true;
                        break;
                    }
                }
                i += 10; 
            }
        }

        let winRate = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(2) : 0;

        const outMsg = `
╔═══════════════════════════╗
║ ⏪ *AI BACKTEST RESULTS* ║
╚═══════════════════════════╝

🪙 Coin: #${coin.replace('USDT', '')} / USDT
⏱️ Timeframe: ${timeframe}
📊 පරීක්ෂා කළ කැන්ඩල්ස්: ${candles.length}

*🎯 Strategy Performance:*
▫️ මුළු Trades ගණන: ${totalTrades}
🟢 ජයග්‍රහණ (TP Hit): ${wins}
🔴 පරාජයන් (SL Hit): ${losses}

🏆 *Win Rate: ${winRate}%*

⚡ *නිගමනය:*
${winRate >= 60 ? "✅ මෙම Timeframe එක මත AI Strategy එක ඉතා සාර්ථකයි!" : winRate >= 40 ? "⚠️ මෙය මධ්‍යම මට්ටමේ සාර්ථකත්වයක් පෙන්වයි. Risk Management අනිවාර්යයි." : "❌ මෙම Coin එකට මෙම Strategy එක සාර්ථක නොමැත."}
`;
        await reply(outMsg.trim());
        await m.react('✅');

    } catch (e) {
        console.log("Backtest Error:", e);
        await reply('❌ Error: Backtesting ක්‍රියාවලියේ දෝෂයක්. ' + e.message);
    }
});
