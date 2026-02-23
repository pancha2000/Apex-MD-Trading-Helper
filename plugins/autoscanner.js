const { cmd } = require('../lib/commands');
const config = require('../config');
const binance = require('../lib/binance');
const indicators = require('../lib/indicators');

// 📌 ප්‍රධාන කොයින්ස් ලැයිස්තුව
let scanList = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOGEUSDT', 'INJUSDT', 'SUIUSDT'];

let scanIntervalId = null; 
let isScanning = false;

// 🔄 පසුබිමෙන් දුවන Top-Down Scan ක්‍රියාවලිය
async function performAutoScan(conn, jid, timeframe = '15m', isFirstRun = false) {
    try {
        let alerts = [];
        
        for (let coin of scanList) {
            try {
                const candles15m = await binance.getKlineData(coin, timeframe, 200);
                const candles1h = await binance.getKlineData(coin, '1h', 100);
                const candles4h = await binance.getKlineData(coin, '4h', 100);

                const currentPrice = parseFloat(candles15m[candles15m.length - 1][4]);

                // 4H & 1H Trend
                const ema50_4h = parseFloat(indicators.calculateEMA(candles4h, 50));
                const trend4H = parseFloat(candles4h[candles4h.length - 1][4]) > ema50_4h ? "UP" : "DOWN";
                const ema50_1h = parseFloat(indicators.calculateEMA(candles1h, 50));
                const trend1H = parseFloat(candles1h[candles1h.length - 1][4]) > ema50_1h ? "UP" : "DOWN";

                // 15m Entry
                const ema200_15m = parseFloat(indicators.calculateEMA(candles15m, 200));
                const ema50_15m = parseFloat(indicators.calculateEMA(candles15m.slice(-50), 50));
                const rsi_15m = parseFloat(indicators.calculateRSI(candles15m.slice(-50)));

                // 🟢 LONG ALERTS
                if (trend4H === "UP" && trend1H === "UP" && currentPrice > ema200_15m) {
                    let diffFromEma50 = Math.abs(currentPrice - ema50_15m) / ema50_15m;
                    if (diffFromEma50 < 0.003 && rsi_15m < 50) {
                        alerts.push(`🟢 *${coin.replace('USDT', '')}* - LONG SETUP\n   📍 Price: $${currentPrice.toFixed(2)}\n   🎯 Entry Zone: $${ema50_15m.toFixed(2)}\n   🤖 Check: ${config.PREFIX}future ${coin.replace('USDT', '')} 15m`);
                        continue;
                    }
                }

                // 🔴 SHORT ALERTS
                if (trend4H === "DOWN" && trend1H === "DOWN" && currentPrice < ema200_15m) {
                    let diffFromEma50 = Math.abs(currentPrice - ema50_15m) / ema50_15m;
                    if (diffFromEma50 < 0.003 && rsi_15m > 50) {
                        alerts.push(`🔴 *${coin.replace('USDT', '')}* - SHORT SETUP\n   📍 Price: $${currentPrice.toFixed(2)}\n   🎯 Entry Zone: $${ema50_15m.toFixed(2)}\n   🤖 Check: ${config.PREFIX}future ${coin.replace('USDT', '')} 15m`);
                        continue;
                    }
                }
            } catch (err) { console.log(`AutoScan Error on ${coin}:`, err.message); }
        }

        if (alerts.length > 0) {
            let outMsg = `🚨 *HIGH PROBABILITY ALERTS* 🚨\n\n` + alerts.join('\n\n');
            await conn.sendMessage(jid, { text: outMsg });
        } else if (isFirstRun) {
            await conn.sendMessage(jid, { text: `✅ *Auto Scanner සක්‍රීයයි!* (${timeframe})\n\nදැනට MTF Trend ගැළපෙන Setups කිසිවක් නොමැත. මම පසුබිමෙන් පරීක්ෂා කරමින් සිටිමි... 🔍` });
        }

    } catch (error) { console.log("AutoScanner Main Error:", error.message); }
}

// ================== AUTOSCAN COMMAND ==================
cmd({
    pattern: "autoscan",
    desc: "Background Auto Scanner for Sniper Setups",
    category: "crypto",
    react: "🔍",
    filename: __filename
},
async (conn, mek, m, { reply, args }) => {
    const action = args[0] ? args[0].toLowerCase() : '';
    
    if (action === 'off') {
        if (!isScanning) return reply("⚠️ Auto Scanner දැනටමත් OFF කර ඇත.");
        clearInterval(scanIntervalId);
        isScanning = false;
        return reply("🛑 *Auto Scanner සාර්ථකව OFF කරන ලදී.*");
    }

    if (action === 'on') {
        if (isScanning) return reply("⚠️ Auto Scanner දැනටමත් ON කර ඇත.");
        
        let intervalMinutes = args[1] ? parseInt(args[1]) : 15;
        if (isNaN(intervalMinutes) || intervalMinutes < 2) return reply("❌ කරුණාකර නිවැරදි විනාඩි ගණනක් ලබා දෙන්න. \nඋදා: .autoscan on 15");

        const targetJid = m.chat || mek.key?.remoteJid || m.key?.remoteJid;
        let timeframe = '15m'; // Default to 15m for Sniper

        isScanning = true;
        reply(`✅ *Auto Scanner ON කරන ලදී!*\n\n⏱️ සෑම විනාඩි ${intervalMinutes} කට වරක්ම කොයින් ${scanList.length} ක් MTF අනුසාරයෙන් පරීක්ෂා කෙරේ. (රැඳී සිටින්න...)`);
        
        // පළමු ස්කෑන් එක
        await performAutoScan(conn, targetJid, timeframe, true);

        // දිගටම ස්කෑන් කිරීම
        scanIntervalId = setInterval(async () => {
            await performAutoScan(conn, targetJid, timeframe, false);
        }, intervalMinutes * 60 * 1000);

        return;
    }

    if (action === 'list') return reply(`📋 *Scanner Coins List (${scanList.length})*\n\n` + scanList.map(c => `🔸 ${c.replace('USDT', '')}`).join('\n'));

    reply(`❌ වැරදි කමාන්ඩ් එකක්!\n\n*භාවිතා කරන ආකාරය:*\n🟢 ON කිරීමට: .autoscan on 15\n🔴 OFF කිරීමට: .autoscan off\n📋 ලැයිස්තුව: .autoscan list`);
});
