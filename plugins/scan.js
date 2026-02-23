const { cmd } = require('../lib/commands');
const config = require('../config');
const binance = require('../lib/binance');
const indicators = require('../lib/indicators');
const smc = require('../lib/smartmoney');

// ස්කෑන් කරන ප්‍රධාන කොයින්ස් 10 (Volume එක වැඩිම ඒවා)
const COINS_TO_SCAN = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'LINKUSDT', 'AVAXUSDT', 'DOGEUSDT', 'INJUSDT', 'SUIUSDT'];

cmd({
    pattern: "scan",
    alias: ["scanner", "find"],
    desc: "Top-Down Multi-Coin Scanner for High Probability Setups",
    category: "crypto",
    react: "🔍",
    filename: __filename
},
async (conn, mek, m, { reply }) => {
    try {
        await m.react('⏳');
        await reply(`⏳ *Top-Down Multi-Coin ස්කෑනරය ක්‍රියාත්මක වේ...*\n(කොයින් 10ක 4H, 1H සහ 15m Timeframes පරීක්ෂා කරමින් පවතී. මෙයට තත්පර 20-30ක් ගතවනු ඇත.)`);

        let foundSetups = [];

        for (let coin of COINS_TO_SCAN) {
            try {
                // Timeframes 3ම ඩවුන්ලෝඩ් කරගැනීම
                const candles15m = await binance.getKlineData(coin, '15m', 200);
                const candles1h = await binance.getKlineData(coin, '1h', 100);
                const candles4h = await binance.getKlineData(coin, '4h', 100);

                const currentPrice = parseFloat(candles15m[candles15m.length - 1][4]);

                // 4H Trend (ලොකුම දිශාව)
                const ema50_4h = parseFloat(indicators.calculateEMA(candles4h, 50));
                const trend4H = parseFloat(candles4h[candles4h.length - 1][4]) > ema50_4h ? "UP" : "DOWN";

                // 1H Trend (මධ්‍යම දිශාව)
                const ema50_1h = parseFloat(indicators.calculateEMA(candles1h, 50));
                const trend1H = parseFloat(candles1h[candles1h.length - 1][4]) > ema50_1h ? "UP" : "DOWN";

                // 15m Entry Data (නිවැරදිම තැන)
                const ema200_15m = parseFloat(indicators.calculateEMA(candles15m, 200));
                const ema50_15m = parseFloat(indicators.calculateEMA(candles15m.slice(-50), 50));
                const rsi_15m = parseFloat(indicators.calculateRSI(candles15m.slice(-50)));
                
                const marketSMC = smc.analyzeSMC(candles15m.slice(-50));
                const fib618 = parseFloat(marketSMC.fib618);
                const res = parseFloat(marketSMC.resistance);
                const sup = parseFloat(marketSMC.support);

                // 🟢 අතිශය තදබල LONG කොන්දේසි (Top-Down Alignment)
                // 4H උඩට, 1H උඩට, 15m මිල EMA 200 ට උඩින්, සහ මිල EMA 50 ට ආසන්නව Pullback වෙලා, RSI < 45 නම්
                if (trend4H === "UP" && trend1H === "UP" && currentPrice > ema200_15m) {
                    let diffFromEma50 = Math.abs(currentPrice - ema50_15m) / ema50_15m;
                    if (diffFromEma50 < 0.003 && rsi_15m < 50) {
                        foundSetups.push({
                            coin: coin.replace('USDT', ''),
                            type: 'LONG 🟢',
                            price: currentPrice.toFixed(2),
                            entryPoint: ema50_15m.toFixed(2),
                            reason: '4H & 1H Bullish, 15m EMA 50 Pullback (Oversold)'
                        });
                        continue;
                    }
                }

                // 🔴 අතිශය තදබල SHORT කොන්දේසි (Top-Down Alignment)
                // 4H පල්ලෙහාට, 1H පල්ලෙහාට, 15m මිල EMA 200 ට පල්ලෙහායින්, සහ මිල EMA 50 ට ආසන්නව Pullback වෙලා, RSI > 55 නම්
                if (trend4H === "DOWN" && trend1H === "DOWN" && currentPrice < ema200_15m) {
                    let diffFromEma50 = Math.abs(currentPrice - ema50_15m) / ema50_15m;
                    if (diffFromEma50 < 0.003 && rsi_15m > 50) {
                        foundSetups.push({
                            coin: coin.replace('USDT', ''),
                            type: 'SHORT 🔴',
                            price: currentPrice.toFixed(2),
                            entryPoint: ema50_15m.toFixed(2),
                            reason: '4H & 1H Bearish, 15m EMA 50 Pullback (Overbought)'
                        });
                        continue;
                    }
                }

            } catch (err) {
                console.log(`Error scanning ${coin}:`, err.message);
            }
        }

        // ප්‍රතිඵල ලබා දීම
        if (foundSetups.length === 0) {
            let noSetupMsg = `╔═══════════════════════════╗\n`;
            noSetupMsg += `║ 🔍 *TOP-DOWN SCAN RESULTS* ║\n`;
            noSetupMsg += `╚═══════════════════════════╝\n\n`;
            noSetupMsg += `මාකට් එකේ දැනට 4H සහ 1H දිශාවන් සමග ගැළපෙන (High Probability) නිවැරදිම Trade Setups කිසිවක් සොයාගැනීමට නොහැකි විය. ⚪\n\n`;
            noSetupMsg += `💡 *උපදෙස:* බොරු Trade දමා මුදල් අවදානමේ නොදමන්න. පැය කිහිපයකින් නැවත .scan භාවිතා කරන්න.`;
            return await reply(noSetupMsg);
        }

        let outMsg = `╔═══════════════════════════╗\n`;
        outMsg += `║ 🎯 *HIGH PROBABILITY SETUPS* ║\n`;
        outMsg += `╚═══════════════════════════╝\n\n`;
        outMsg += `ස්කෑන් කළ කොයින්ස්: 10\nහමුවූ Setups ගණන: ${foundSetups.length} 🔥\n\n`;

        foundSetups.forEach((setup, index) => {
            outMsg += `*${index + 1}. #${setup.coin}* - ${setup.type}\n`;
            outMsg += `   📍 Current Price: $${setup.price}\n`;
            outMsg += `   🎯 Ideal Entry Zone: $${setup.entryPoint}\n`;
            outMsg += `   ⚙️ Setup: ${setup.reason}\n`;
            outMsg += `   🤖 AI Check: *${config.PREFIX}future ${setup.coin} 15m*\n\n`;
        });

        outMsg += `⚡ *මීළඟ පියවර:* ඉහත කොයින් සඳහා AI Check හි ඇති කමාන්ඩ් එක යවා සම්පූර්ණ Entry, TP සහ SL ලබාගන්න.`;

        await reply(outMsg.trim());
        await m.react('✅');

    } catch (e) {
        await reply('❌ Error: ස්කෑනරයේ දෝෂයක්. ' + e.message);
    }
});
