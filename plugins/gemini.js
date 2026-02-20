const { cmd } = require('../lib/commands');
const config = require('../config');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Initialize Gemini
let genAI;
if (config.GEMINI_API) {
    genAI = new GoogleGenerativeAI(config.GEMINI_API);
}

cmd({
    pattern: "ai",
    alias: ["gemini", "gpt", "ask"],
    desc: "Chat with AI (Gemini)",
    category: "ai",
    react: "🤖",
    filename: __filename
},
async (conn, mek, m, { reply, text }) => {
    try {
        if (!text) {
            return await reply('❌ කරුණාකර question එකක් ඇහුවන්න!\n\nExample: .ai What is AI?');
        }

        if (!config.GEMINI_API) {
            return await reply('❌ GEMINI_API key එක config.env එකේ නැහැ!\n\nAPI key එකක් ගන්න: https://makersuite.google.com/app/apikey');
        }

        await m.react('🤔');

        // Generate content
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });
        const result = await model.generateContent(text);
        const response = await result.response;
        const aiResponse = response.text();

        if (!aiResponse) {
            await m.react('❌');
            return await reply('❌ AI response එකක් ලබාගන්න බැරි වුණා!');
        }

        // Format response
        const formattedResponse = `
╔═══════════════════════════╗
║      🤖 *AI RESPONSE*     ║
╚═══════════════════════════╝

${aiResponse}

> *Powered by Google Gemini*
`;

        await reply(formattedResponse);
        await m.react('✅');

    } catch (e) {
        await m.react('❌');
        if (e.message.includes('API key')) {
            await reply('❌ Invalid API key! config.env එකේ GEMINI_API එක check කරන්න.');
        } else {
            await reply('❌ Error: ' + e.message);
        }
        console.log('AI error:', e);
    }
});

// Alternative OpenAI version
cmd({
    pattern: "chatgpt",
    alias: ["gpt3", "openai"],
    desc: "Chat with ChatGPT",
    category: "ai",
    react: "🧠",
    filename: __filename
},
async (conn, mek, m, { reply, text }) => {
    try {
        if (!text) {
            return await reply('❌ කරුණාකර question එකක් ඇහුවන්න!\n\nExample: .chatgpt Explain quantum physics');
        }

        if (!config.OPENAI_API) {
            return await reply('❌ OPENAI_API key එක config.env එකේ නැහැ!\n\nFree alternative: Use .ai command');
        }

        await m.react('🤔');

        // Use OpenAI API
        const { Configuration, OpenAIApi } = require('openai');
        const configuration = new Configuration({
            apiKey: config.OPENAI_API,
        });
        const openai = new OpenAIApi(configuration);

        const completion = await openai.createChatCompletion({
            model: "gpt-3.5-turbo",
            messages: [{ role: "user", content: text }],
        });

        const aiResponse = completion.data.choices[0].message.content;

        const formattedResponse = `
╔═══════════════════════════╗
║    🧠 *CHATGPT RESPONSE*  ║
╚═══════════════════════════╝

${aiResponse}

> *Powered by OpenAI*
`;

        await reply(formattedResponse);
        await m.react('✅');

    } catch (e) {
        await m.react('❌');
        await reply('❌ Error: ' + e.message + '\n\nTip: Use .ai command as free alternative!');
        console.log('ChatGPT error:', e);
    }
});