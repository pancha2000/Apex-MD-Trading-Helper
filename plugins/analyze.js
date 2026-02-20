const { cmd } = require('../lib/commands');
const config = require('../config');
const axios = require('axios');
const db = require('../lib/database');

// ================== MARKET MATH & SMC FUNCTIONS ==================

// 1. Binance එකෙන් කැන්ඩල්ස් 100ක් ලබාගැනීම
async function getKlineData(coin, timeframe) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${coin}&interval=${timeframe}&limit=100`;
    const res = await axios.get(url, { headers: { 'X-MBX-APIKEY': config.BINANCE_API } });
    return res.data;
}

// 2. RSI (Relative Strength Index) ගණනය කිරීම
function calculateRSI(candles, period = 14) {
    let gains = 0,
        losses = 0;
    for (let i = candles.length - period - 1; i < candles.length - 1; i++) {
        let change = parseFloat(candles[i + 1][4]) - parseFloat(candles[i][4]);
        if (change > 0) gains += change;
        else losses -= change;
    }
    let rs = (gains / period) / (losses / period || 1);
    return (100 - (100 / (1 + rs))).toFixed(2);
}

// 3. Support & Resistance සහ FVG (Fair Value Gaps) සෙවීම
function analyzeSMC(candles) {
    let highs = candles.map(c => parseFloat(c[2]));
    let lows = candles.map(c => parseFloat(c[3]));
    
    // Major Support & Resistance (අවසන් කැන්ඩල්ස් 100 තුළ)
    let resistance = Math.max(...highs).toFixed(2);
    let support = Math.min(...lows).toFixed(2);
    
    // FVG හොයාගැනීම (අවසන් කැන්ඩල්ස් 20 තුළ)
    let bullishFVG = "None";
    let bearishFVG = "None";
    
    for (let i = candles.length - 20; i < candles.length - 1; i++) {
        if (i < 2) continue;
        let c1High = parseFloat(candles[i - 2][2]);
        let c3Low = parseFloat(candles[i][3]);
        let c1Low = parseFloat(candles[i - 2][3]);
        let c3High = parseFloat(candles[i][2]);
        
        if (c1High < c3Low) bullishFVG = `$${c1High.toFixed(2)} - $${c3Low.toFixed(2)}`;
        if (c1Low > c3High) bearishFVG = `$${c3High.toFixed(2)} - $${c1Low.toFixed(2)}`;
    }
    
    return { support, resistance, bullishFVG, bearishFVG };
}

// අවසන් කැන්ඩල්ස් 10 පමණක් AI එකට යැවීමට සැකසීම
function formatRecentCandles(candles) {
    const recent = candles.slice(-10);
    return recent.map((c, i) => `C${i + 1}: O=$${parseFloat(c[1]).toFixed(2)}, H=$${parseFloat(c[2]).toFixed(2)}, L=$${parseFloat(c[3]).toFixed(2)}, C=$${parseFloat(c[4]).toFixed(2)}`).join('\n');
}

// ================== SPOT COMMAND ==================
cmd({
        pattern: "spot",
        desc: "Advanced Spot Trading Analysis",
        category: "crypto",
        react: "🟢",
        filename: __filename
    },
    async (conn, mek, m, { reply, args }) => {
        try {
            if (!args[0]) return await reply(`❌ කරුණාකර Coin එකක් ලබා දෙන්න!\n*උදා:* ${config.PREFIX}spot BTC 4h`);
            if (!config.GROQ_API) return await reply('❌ GROQ_API key එක නැහැ!');
            
            let coin = args[0].toUpperCase();
            if (!coin.endsWith('USDT')) coin += 'USDT';
            let timeframe = args[1] ? args[1].toLowerCase() : '1d';
            
            await m.react('⏳');
            await reply(`⏳ *Binance (${timeframe}) දත්ත 100ක් ලබා ගනිමින් FVG සහ RSI ගණනය කරමින් පවතී...*`);
            
            const candles = await getKlineData(coin, timeframe);
            const currentPrice = parseFloat(candles[candles.length - 1][4]).toFixed(2);
            
            // ගණනය කිරීම්
            const rsi = calculateRSI(candles);
            const smc = analyzeSMC(candles);
            const recentCandles = formatRecentCandles(candles);
            
            const prompt = `You are an expert Crypto Institutional Trader (ICT/SMC). Analyze ${coin} on ${timeframe}.
        
        We have calculated the following from the last 100 candles:
        - Current Price: $${currentPrice}
        - 14-Period RSI: ${rsi} (Overbought > 70, Oversold < 30)
        - Major Resistance: $${smc.resistance}
        - Major Support: $${smc.support}
        - Recent Bullish FVG: ${smc.bullishFVG}
        - Recent Bearish FVG: ${smc.bearishFVG}

        Last 10 Candles Price Action:
        ${recentCandles}

        Provide a professional Sinhala analysis for SPOT TRADING. Include:
        1. Current Trend & SMC Bias
        2. Trade Confidence Score (e.g., Confidence: 85%)
        3. Best Entry Zones based on FVG/Support
        4. Targets & Risk

        IMPORTANT: At the very end of your response, strictly output this exact format with your estimated numbers:
        [TARGETS|ENTRY:number|TP:number|SL:number]`;
            
            const groqUrl = 'https://api.groq.com/openai/v1/chat/completions';
            const aiRes = await axios.post(groqUrl, {
                model: "llama-3.3-70b-versatile",
                messages: [{ role: "user", content: prompt }]
            }, { headers: { 'Authorization': `Bearer ${config.GROQ_API}`, 'Content-Type': 'application/json' } });
            
            const aiResponse = aiRes.data.choices[0].message.content;
            
            const outMsg = `
╔═══════════════════════════╗
║  🟢 *SPOT TRADE ANALYSIS* ║
╚═══════════════════════════╝
🪙 *Coin:* ${coin.replace('USDT', '')}
⏱️ *Timeframe:* ${timeframe}
💲 *Current Price:* $${currentPrice}
📊 *RSI:* ${rsi}

${aiResponse}

> 📌 *මෙම Trade එක Track කිරීමට අවශ්‍ය නම්, මෙම පණිවිඩයට Reply කරමින් .track ලෙස යවන්න.*`;
            
            await reply(outMsg);
            await m.react('✅');
        } catch (e) { await reply('❌ Error: ' + e.message); }
    });

// ================== FUTURES COMMAND ==================
cmd({
        pattern: "future",
        alias: ["futures"],
        desc: "Advanced Futures Trading Analysis",
        category: "crypto",
        react: "🔴",
        filename: __filename
    },
    async (conn, mek, m, { reply, args }) => {
        try {
            if (!args[0]) return await reply(`❌ කරුණාකර Coin එකක් ලබා දෙන්න!\n*උදා:* ${config.PREFIX}future BTC 15m`);
            if (!config.GROQ_API) return await reply('❌ GROQ_API key එක නැහැ!');
            
            let coin = args[0].toUpperCase();
            if (!coin.endsWith('USDT')) coin += 'USDT';
            let timeframe = args[1] ? args[1].toLowerCase() : '15m';
            
            await m.react('⏳');
            await reply(`⏳ *Binance (${timeframe}) දත්ත 100ක් ලබා ගනිමින් ICT/SMC මට්ටම් සොයමින් පවතී...*`);
            
            const candles = await getKlineData(coin, timeframe);
            const currentPrice = parseFloat(candles[candles.length - 1][4]).toFixed(2);
            
            // ගණනය කිරීම්
            const rsi = calculateRSI(candles);
            const smc = analyzeSMC(candles);
            const recentCandles = formatRecentCandles(candles);
            
            const prompt = `You are an expert Crypto Futures Institutional Trader (ICT/SMC). Analyze ${coin} on ${timeframe}.
        
        We have calculated the following from the last 100 candles:
        - Current Price: $${currentPrice}
        - 14-Period RSI: ${rsi} (Overbought > 70, Oversold < 30)
        - Major Resistance: $${smc.resistance}
        - Major Support: $${smc.support}
        - Recent Bullish FVG: ${smc.bullishFVG}
        - Recent Bearish FVG: ${smc.bearishFVG}

        Last 10 Candles Price Action:
        ${recentCandles}

        Provide a professional Sinhala analysis for FUTURES TRADING. Include:
        1. Smart Money Market Trend
        2. Trade Confidence Score (e.g., Confidence: 90%)
        3. Long/Short Entry Point (Use FVG or S/R)
        4. Strict Stop-Loss and Take-Profit

        IMPORTANT: At the very end of your response, strictly output this exact format with your estimated numbers:
        [TARGETS|ENTRY:number|TP:number|SL:number]`;
            
            const groqUrl = 'https://api.groq.com/openai/v1/chat/completions';
            const aiRes = await axios.post(groqUrl, {
                model: "llama-3.3-70b-versatile",
                messages: [{ role: "user", content: prompt }]
            }, { headers: { 'Authorization': `Bearer ${config.GROQ_API}`, 'Content-Type': 'application/json' } });
            
            const aiResponse = aiRes.data.choices[0].message.content;
            
            const outMsg = `
╔═══════════════════════════╗
║ 🔴 *FUTURES TRADE ANALYSIS* ║
╚═══════════════════════════╝
🪙 *Coin:* ${coin.replace('USDT', '')}
⏱️ *Timeframe:* ${timeframe}
💲 *Current Price:* $${currentPrice}
📊 *RSI:* ${rsi}

${aiResponse}

> 📌 *මෙම Trade එක Track කිරීමට අවශ්‍ය නම්, මෙම පණිවිඩයට Reply කරමින් .track ලෙස යවන්න.*`;
            
            await reply(outMsg);
            await m.react('✅');
        } catch (e) { await reply('❌ Error: ' + e.message); }
    });

// ================== TRACK COMMAND ==================
cmd({
        pattern: "track",
        desc: "Save and track a crypto trade",
        category: "crypto",
        react: "🎯",
        filename: __filename
    },
    async (conn, mek, m, { reply }) => {
        try {
            if (!m.quoted) return await reply('❌ කරුණාකර AI එකෙන් දුන්න Analysis මැසේජ් එකට Reply කරමින් .track ලෙස යවන්න.');
            
            const quotedText = m.quoted.conversation || m.quoted.extendedTextMessage?.text || m.quoted.text || m.quoted.body || "";
            if (!quotedText) return await reply('❌ Quoted මැසේජ් එක කියවීමට නොහැක.');
            
            const coinMatch = quotedText.match(/🪙 \*Coin:\* ([A-Z]+)/);
            if (!coinMatch) return await reply('❌ මෙය නිවැරදි Analysis පණිවිඩයක් නොවේ.');
            const coin = coinMatch[1] + 'USDT';
            const type = quotedText.includes('SPOT') ? 'spot' : 'future';
            
            const targetMatch = quotedText.match(/\[TARGETS\|ENTRY:\s*([0-9.]+)\s*\|TP:\s*([0-9.]+)\s*\|SL:\s*([0-9.]+)\s*\]/);
            
            if (!targetMatch) return await reply('❌ AI එක විසින් Entry/TP/SL දත්ත ලබා දී නැත.');
            
            const entry = parseFloat(targetMatch[1]);
            const tp = parseFloat(targetMatch[2]);
            const sl = parseFloat(targetMatch[3]);
            
            await db.saveTrade({
                userJid: m.sender,
                coin: coin,
                type: type,
                entry: entry,
                tp: tp,
                sl: sl
            });
            
            await reply(`✅ *${coin}* Trade එක සාර්ථකව Track කිරීම ආරම්භ කළා!\n\n🎯 *Entry:* $${entry}\n💰 *TP:* $${tp}\n🛑 *SL:* $${sl}\n\n(Trade එකේ තත්වය වෙනස් වූ විට මම ඔබව දැනුවත් කරමි)`);
            await m.react('✅');
            
        } catch (e) {
            await m.react('❌');
            await reply('❌ Error: ' + e.message);
        }
    });