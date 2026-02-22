const { cmd } = require('../lib/commands');
const config = require('../config');
const binance = require('../lib/binance');
const indicators = require('../lib/indicators');
const smc = require('../lib/smartmoney');

// 📌 Default Coins List (ප්‍රධාන කොයින් ටික)
let scanList = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOGEUSDT', 'DOTUSDT'];

let scanIntervalId = null; 
let isScanning = false;

// ස්කෑන් කිරීමේ ක්‍රියාවලිය
async function performScan(conn, jid, timeframe = '15m') {
    try {
        let alerts = [];
        
        for (let coin of scanList) {
            // දත්ත ලබාගැනීම
            const candles = await binance.getKlineData(coin, timeframe, 50);
            const currentPrice = parseFloat(candles[candles.length - 1][4]);
            
            const rsi = parseFloat(indicators.calculateRSI(candles));
            const pattern = indicators.checkCandlePattern(candles);
            const marketSMC = smc.analyzeSMC(candles);

            let signal = null;

            // 1. Oversold + Bullish Pattern (Long)
            if (rsi < 35 && pattern.includes('🟢')) {
                signal = 'LONG 🟢';
            }
            // 2. Overbought + Bearish Pattern (Short)
            else if (rsi > 65 && pattern.includes('🔴')) {
                signal = 'SHORT 🔴';
            }
            
            // 3. Golden Pocket (0.618 Fib) අසල නම්
            const fib618 = parseFloat(marketSMC.fib618);
            const diffPercent = Math.abs(currentPrice - fib618) / fib618 * 100;
            if (diffPercent < 0.5 && !signal) { 
                signal = 'WATCH ⚠️'; 
            }

            // කෙටි Alert එකක් සෑදීම (ඔයා ඉල්ලපු විදියටම)
            if (signal) {
                let cleanCoin = coin.replace('USDT', '');
                alerts.push(`🪙 *${cleanCoin}* - ${signal}`);
            }
        }

        // අවස්ථා හමුවුණා නම් පමණක් Group එකට මැසේජ් එක යැවීම
        if (alerts.length > 0) {
            const outMsg = `🚨 *MARKET ALERTS (${timeframe})* 🚨\n\n` + alerts.join('\n');
            await conn.sendMessage(jid, { text: outMsg });
        }
    } catch (error) {
        console.log("Scanner Error:", error.message);
    }
}

// ================== AUTOSCAN COMMAND ==================
cmd({
    pattern: "autoscan",
    desc: "Manage Auto Scanner & Coin List",
    category: "crypto",
    react: "🔍",
    filename: __filename
},
async (conn, mek, m, { reply, args }) => {
    const action = args[0] ? args[0].toLowerCase() : '';
    
    // 1. OFF කිරීම
    if (action === 'off') {
        if (!isScanning) return reply("⚠️ Auto Scanner දැනටමත් OFF කර ඇත.");
        clearInterval(scanIntervalId);
        isScanning = false;
        return reply("🛑 *Auto Scanner සාර්ථකව OFF කරන ලදී.*");
    }

    // 2. ON කිරීම
    if (action === 'on') {
        if (isScanning) return reply("⚠️ Auto Scanner දැනටමත් ON කර ඇත. වෙනස් කිරීමට පළමුව එය '.autoscan off' මගින් OFF කරන්න.");
        
        let intervalMinutes = args[1] ? parseInt(args[1]) : 15;
        if (isNaN(intervalMinutes) || intervalMinutes < 5) return reply("❌ කරුණාකර නිවැරදි විනාඩි ගණනක් ලබා දෙන්න (අවම විනාඩි 5). \nඋදා: .autoscan on 15 15m");

        let timeframe = args[2] ? args[2].toLowerCase() : '15m'; 

        isScanning = true;
        reply(`✅ *Auto Scanner ON කරන ලදී!*\n\n⏱️ පරතරය: විනාඩි ${intervalMinutes}\n📊 Timeframe: ${timeframe}\n🪙 Coins: ${scanList.length}\n\n(පළමු Scan එක දැන් ආරම්භ වේ...)`);
        
        await performScan(conn, m.chat, timeframe);

        scanIntervalId = setInterval(async () => {
            await performScan(conn, m.chat, timeframe);
        }, intervalMinutes * 60 * 1000);

        return;
    }

    // 3. අලුත් Coin එකක් එකතු කිරීම
    if (action === 'add') {
        if (!args[1]) return reply("❌ කරුණාකර Coin එකක් ලබා දෙන්න. \nඋදා: .autoscan add FET");
        let newCoin = args[1].toUpperCase();
        if (!newCoin.endsWith('USDT')) newCoin += 'USDT';
        
        if (scanList.includes(newCoin)) return reply(`⚠️ ${newCoin} දැනටමත් Scanner ලිස්ට් එකේ තියෙනවා!`);
        scanList.push(newCoin);
        return reply(`✅ *${newCoin}* සාර්ථකව Scanner ලිස්ට් එකට එකතු කළා!`);
    }

    // 4. Coin එකක් ඉවත් කිරීම
    if (action === 'remove') {
        if (!args[1]) return reply("❌ කරුණාකර Coin එකක් ලබා දෙන්න. \nඋදා: .autoscan remove FET");
        let delCoin = args[1].toUpperCase();
        if (!delCoin.endsWith('USDT')) delCoin += 'USDT';
        
        const index = scanList.indexOf(delCoin);
        if (index > -1) {
            scanList.splice(index, 1);
            return reply(`🗑️ *${delCoin}* Scanner ලිස්ට් එකෙන් ඉවත් කළා!`);
        } else {
            return reply(`⚠️ ${delCoin} ලිස්ට් එකේ නැහැ!`);
        }
    }

    // 5. දැනට තියෙන Coins ටික බැලීම
    if (action === 'list') {
        let listMsg = `📋 *Scanner Coins List (${scanList.length})*\n\n` + scanList.map(c => `🔸 ${c.replace('USDT', '')}`).join('\n');
        return reply(listMsg);
    }

    // නිවැරදි කමාන්ඩ් එක ලබා නොදුන් විට පෙන්වන Help මෙනුව
    reply(`❌ වැරදි කමාන්ඩ් එකක්!\n\n*භාවිතා කරන ආකාරය:*\n🟢 ON කිරීමට: .autoscan on 15 15m\n🔴 OFF කිරීමට: .autoscan off\n➕ Coin එකතු කිරීමට: .autoscan add WIF\n➖ Coin ඉවත් කිරීමට: .autoscan remove WIF\n📋 Coins ලැයිස්තුව බැලීමට: .autoscan list`);
});
