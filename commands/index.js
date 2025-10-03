// Command Registration - All bot commands
const { formatNumber } = require('../utils/helpers');
const config = require('../config/config');
const news = require('../services/news');

// Register all commands
function registerCommands(bot, priceFeeds, alerts) {
  const { getCachedCryptoData, getCryptoData } = priceFeeds;
  const { getPriceAlerts, getAutoAlerts } = alerts;
  
  const priceAlerts = getPriceAlerts();
  const autoAlerts = getAutoAlerts();

  // /start command
  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const welcomeMessage = `
🤖 Welcome to rCryptoBot!

I'm your cryptocurrency assistant. Here are some commands you can use:

/help - Show available commands
/crypto - Get crypto information
/price <symbol> - Get price for a specific cryptocurrency (e.g., /price BTC)
/alert <symbol> <price> - Set price alert (e.g., /alert BTC 50000)
/autoalerts - Toggle automatic 3% volatility alerts
/alerts - View your active alerts
/settings - Bot settings

Start by typing /help for more information!
    `;
    bot.sendMessage(chatId, welcomeMessage);
  });

  // /help command
  bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    const helpMessage = `
📚 Available Commands:

/start - Welcome message and basic info
/help - Show this help message
/crypto - Get general crypto information
/price <symbol> - Get current price (e.g., /price BTC, /price ETH)
/news <symbol> - AI-powered news briefing with market activity ⚡
/alert <symbol> <target_price> - Set intelligent price alert
/alerts - View your active alerts
/clearalerts - Clear all alerts
/autoalerts - Toggle automatic 3% volatility alerts
/settings - Configure bot settings
/stop - Stop the bot

💡 Tips:
- Use cryptocurrency symbols like BTC, ETH, ADA, SOL, etc.
- News command uses ChatGPT to analyze Reddit + market activity
- Price alerts will notify you when targets are reached
- Auto-alerts monitor major cryptos for 3% moves automatically
    `;
    bot.sendMessage(chatId, helpMessage);
  });

  // /crypto command
  bot.onText(/\/crypto/, async (msg) => {
    const chatId = msg.chat.id;
    const loadingMsg = await bot.sendMessage(chatId, '⏳ Fetching live crypto market data...');
    
    try {
      const topCoins = ['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'DOT', 'UNI', 'LINK', 'AAVE'];
      const cryptoPromises = topCoins.map(symbol => getCryptoData(symbol));
      const cryptoDataArray = await Promise.all(cryptoPromises);
      
      let marketOverview = '📊 **Live Crypto Market Overview**\n\n';
      
      for (let i = 0; i < topCoins.length; i++) {
        const symbol = topCoins[i];
        const data = cryptoDataArray[i];
        
        if (data) {
          const changeEmoji = parseFloat(data.change24h) >= 0 ? '📈' : '📉';
          const changeSign = parseFloat(data.change24h) >= 0 ? '+' : '';
          marketOverview += `**${symbol}:** $${formatNumber(data.price)} ${changeEmoji} ${changeSign}${data.change24h}%\n`;
        }
      }
      
      const cryptoMessage = `
${marketOverview}

💡 **About Cryptocurrency:**
Digital currency secured by cryptography.

📈 **Commands:**
/price <symbol> - Get detailed price info
/alert <symbol> <price> - Set price alerts

*Data provided by CoinGecko API*
*Updated: ${new Date().toLocaleTimeString()}*
      `;

      bot.editMessageText(cryptoMessage, {
        chat_id: chatId,
        message_id: loadingMsg.message_id,
        parse_mode: 'Markdown'
      });
    } catch (error) {
      console.error('Error in /crypto command:', error);
      bot.editMessageText('❌ Sorry, there was an error fetching crypto market data. Please try again later.', {
        chat_id: chatId,
        message_id: loadingMsg.message_id
      });
    }
  });

  // /price command
  bot.onText(/\/price (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const symbol = match[1].toUpperCase();
    const loadingMsg = await bot.sendMessage(chatId, '⏳ Fetching real-time price data...');

    try {
      const cryptoData = await getCachedCryptoData(symbol);

      if (cryptoData) {
        const changeEmoji = parseFloat(cryptoData.change24h) >= 0 ? '📈' : '📉';
        const changeSign = parseFloat(cryptoData.change24h) >= 0 ? '+' : '';
        
        const priceMessage = `
💰 **${symbol} Price Information**

**Current Price:** $${formatNumber(cryptoData.price)}
**24h Change:** ${changeEmoji} ${changeSign}${cryptoData.change24h}%
**Market Cap:** $${formatNumber(cryptoData.marketCap)}
**24h Volume:** $${formatNumber(cryptoData.volume24h)}

*Data provided by CoinGecko API*
*Last updated: ${new Date().toLocaleTimeString()}*
        `;
        
        bot.editMessageText(priceMessage, {
          chat_id: chatId,
          message_id: loadingMsg.message_id,
          parse_mode: 'Markdown'
        });
      } else {
        bot.editMessageText(
          `❌ Sorry, I couldn't find price data for **${symbol}**.\n\nTry supported symbols like: BTC, ETH, SOL, XRP`,
          {
            chat_id: chatId,
            message_id: loadingMsg.message_id,
            parse_mode: 'Markdown'
          }
        );
      }
    } catch (error) {
      console.error('Error in /price command:', error);
      bot.editMessageText('❌ Sorry, there was an error fetching the price data. Please try again later.', {
        chat_id: chatId,
        message_id: loadingMsg.message_id
      });
    }
  });

  bot.onText(/^\/price$/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, 'Please specify a cryptocurrency symbol. Example: /price BTC');
  });

  // /news command
  bot.onText(/\/news (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const symbol = match[1].toUpperCase();

    const loadingMsg = await bot.sendMessage(chatId, `📊 **${symbol} PREMIUM BRIEFING IN PROGRESS**\n\n⏳ **Step 1:** Sourcing premium data...\n🔍 **Step 2:** Quality filtering...\n🤖 **Step 3:** ChatGPT analysis...\n📰 **Step 4:** Generating briefing...`);

    try {
      const newsData = await news.aggregateQualityNews(symbol, getCachedCryptoData);
      
      await bot.editMessageText(`📊 **${symbol} PREMIUM BRIEFING IN PROGRESS**\n\n✅ **Step 1:** Sourcing premium data...\n⏳ **Step 2:** Quality filtering...\n🤖 **Step 3:** ChatGPT analysis...\n📰 **Step 4:** Generating briefing...`, {
        chat_id: chatId,
        message_id: loadingMsg.message_id
      });

      await bot.editMessageText(`📊 **${symbol} PREMIUM BRIEFING IN PROGRESS**\n\n✅ **Step 1:** Sourcing premium data...\n✅ **Step 2:** Quality filtering...\n⏳ **Step 3:** ChatGPT analysis...\n📰 **Step 4:** Generating briefing...`, {
        chat_id: chatId,
        message_id: loadingMsg.message_id
      });

      const comprehensiveBriefing = await news.getComprehensiveBriefing(newsData, symbol);
      
      await bot.editMessageText(`📊 **${symbol} PREMIUM BRIEFING IN PROGRESS**\n\n✅ **Step 1:** Sourcing premium data...\n✅ **Step 2:** Quality filtering...\n✅ **Step 3:** ChatGPT analysis...\n⏳ **Step 4:** Generating briefing...`, {
        chat_id: chatId,
        message_id: loadingMsg.message_id
      });
      
      const professionalBriefing = news.generateProfessionalBriefing(newsData, comprehensiveBriefing, symbol);

      bot.editMessageText(professionalBriefing, {
        chat_id: chatId,
        message_id: loadingMsg.message_id,
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      });

    } catch (error) {
      console.error('Error in /news command:', error);
      bot.editMessageText(
        `❌ **BRIEFING GENERATION FAILED**\n\n` +
        `Unable to generate ${symbol} briefing.\n\n` +
        `**Solutions:**\n` +
        `• Try again in 2-3 minutes\n` +
        `• Use /price ${symbol} for market data\n\n` +
        `*Professional briefings use ChatGPT analysis*`,
        {
          chat_id: chatId,
          message_id: loadingMsg.message_id,
          parse_mode: 'Markdown'
        }
      );
    }
  });

  bot.onText(/^\/news$/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, 'Please specify a cryptocurrency symbol. Example: /news BTC');
  });

  // /alert command
  bot.onText(/\/alert (.+) (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const symbol = match[1].toUpperCase();
    const targetPrice = parseFloat(match[2]);

    if (isNaN(targetPrice)) {
      bot.sendMessage(chatId, '❌ Invalid price. Please provide a valid number for the target price.');
      return;
    }

    const loadingMsg = await bot.sendMessage(chatId, '⏳ Verifying cryptocurrency symbol...');

    try {
      const cryptoData = await getCryptoData(symbol);

      if (!cryptoData) {
        bot.editMessageText(
          `❌ Sorry, I couldn't find data for **${symbol}**. Please check the symbol and try again.\n\nSupported symbols: BTC, ETH, SOL, XRP`,
          {
            chat_id: chatId,
            message_id: loadingMsg.message_id,
            parse_mode: 'Markdown'
          }
        );
        return;
      }

      if (!priceAlerts[chatId]) {
        priceAlerts[chatId] = [];
      }

      priceAlerts[chatId].push({
        symbol: symbol,
        targetPrice: targetPrice,
        currentPrice: cryptoData.price,
        timestamp: new Date(),
        alertId: `${symbol}_${targetPrice}_${Date.now()}`,
        status: 'active'
      });

      const currentPrice = formatNumber(cryptoData.price);
      const targetFormatted = formatNumber(targetPrice);
      const direction = targetPrice > cryptoData.price ? 'above' : 'below';
      const percentage = Math.abs(((targetPrice - cryptoData.price) / cryptoData.price) * 100).toFixed(2);

      bot.editMessageText(
        `✅ **Alert Set Successfully!**\n\n` +
        `**Symbol:** ${symbol}\n` +
        `**Current Price:** $${currentPrice}\n` +
        `**Target Price:** $${targetFormatted}\n` +
        `**Direction:** ${direction} current price\n` +
        `**Difference:** ${percentage}%\n\n` +
        `I'll notify you when ${symbol} reaches $${targetFormatted}!`,
        {
          chat_id: chatId,
          message_id: loadingMsg.message_id,
          parse_mode: 'Markdown'
        }
      );
    } catch (error) {
      console.error('Error in /alert command:', error);
      bot.editMessageText('❌ Sorry, there was an error setting up the alert. Please try again later.', {
        chat_id: chatId,
        message_id: loadingMsg.message_id
      });
    }
  });

  bot.onText(/^\/alert$/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, 'Please specify symbol and target price. Example: /alert BTC 50000');
  });

  // /alerts command
  bot.onText(/\/alerts/, (msg) => {
    const chatId = msg.chat.id;

    if (!priceAlerts[chatId] || priceAlerts[chatId].length === 0) {
      bot.sendMessage(chatId, '📋 **No alerts set**\n\nUse `/alert SYMBOL PRICE` to set a price alert.\nExample: `/alert BTC 45000`', { parse_mode: 'Markdown' });
      return;
    }

    const activeAlerts = priceAlerts[chatId].filter(alert => alert.status === 'active');
    const triggeredAlerts = priceAlerts[chatId].filter(alert => alert.status === 'triggered');

    let message = '📋 **Your Alert Status**\n\n';

    if (activeAlerts.length > 0) {
      message += `🔔 **Active Alerts (${activeAlerts.length})**\n`;
      activeAlerts.forEach((alert, index) => {
        const direction = alert.targetPrice > alert.currentPrice ? '📈 ABOVE' : '📉 BELOW';
        const currentPrice = alert.currentPrice.toFixed(2);
        const targetPrice = alert.targetPrice.toFixed(2);
        const setTime = new Date(alert.timestamp).toLocaleString();

        message += `${index + 1}. **${alert.symbol}** ${direction} $${targetPrice}\n`;
        message += `   Set when: $${currentPrice} | Time: ${setTime}\n\n`;
      });
    } else {
      message += '🔔 **No active alerts**\n\n';
    }

    if (triggeredAlerts.length > 0) {
      message += `✅ **Triggered Alerts (${triggeredAlerts.length})**\n`;
      triggeredAlerts.slice(-3).forEach((alert, index) => {
        const triggerTime = alert.triggerTime ? new Date(alert.triggerTime).toLocaleString() : 'Unknown';
        const triggerPrice = alert.triggerPrice ? alert.triggerPrice.toFixed(2) : 'Unknown';

        message += `${index + 1}. **${alert.symbol}** triggered at $${triggerPrice}\n`;
        message += `   Time: ${triggerTime}\n\n`;
      });
    }

    message += '💡 *Alerts are checked every 30 seconds*\n';
    message += '🗑️ *Use /clearalerts to remove all alerts*';

    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  });

  // /clearalerts command
  bot.onText(/\/clearalerts/, (msg) => {
    const chatId = msg.chat.id;

    if (priceAlerts[chatId]) {
      const alertCount = priceAlerts[chatId].length;
      delete priceAlerts[chatId];
      bot.sendMessage(chatId, `🗑️ **Cleared ${alertCount} alert(s)**\n\nUse \`/alert SYMBOL PRICE\` to set new alerts.`, { parse_mode: 'Markdown' });
    } else {
      bot.sendMessage(chatId, '📋 **No alerts to clear**');
    }
  });

  // /autoalerts command
  bot.onText(/\/autoalerts/, (msg) => {
    const chatId = msg.chat.id;
    const realtimePrices = priceFeeds.getRealtimePrices();
    
    if (autoAlerts.enabled[chatId]) {
      autoAlerts.enabled[chatId] = false;
      bot.sendMessage(chatId, 
        `🔕 **Auto-Volatility Alerts Disabled**\n\n` +
        `You will no longer receive automatic notifications for 3% price moves.\n\n` +
        `Use \`/autoalerts\` to enable again.`,
        { parse_mode: 'Markdown' }
      );
    } else {
      autoAlerts.enabled[chatId] = true;
      
      const trackedSymbols = Array.from(realtimePrices.keys()).sort();
      const symbolList = trackedSymbols.length > 0 ? trackedSymbols.map(s => `• ${s}`).join('\n') : '• Loading...';
      
      bot.sendMessage(chatId,
        `🔔 **Auto-Volatility Alerts Enabled**\n\n` +
        `You'll be notified when any of these cryptos move ±3% or more:\n\n` +
        `${symbolList}\n\n` +
        `**Features:**\n` +
        `• Real-time monitoring (10 second updates)\n` +
        `• 1 hour cooldown between alerts per coin\n` +
        `• Zero API calls - uses cached real-time data\n` +
        `• Works 24/7 in the background\n\n` +
        `💡 Currently tracking **${trackedSymbols.length} coins** with live price feeds!\n\n` +
        `Use \`/autoalerts\` to disable.`,
        { parse_mode: 'Markdown' }
      );
    }
  });

  // /settings command
  bot.onText(/\/settings/, (msg) => {
    const chatId = msg.chat.id;
    const settingsMessage = `
⚙️ Bot Settings

Current settings:
• Notifications: Enabled
• Alert frequency: Real-time
• Default currency: USD
• Language: English

Available commands:
/autoalerts - Toggle auto volatility alerts
/clearalerts - Clear all price alerts

Type the command you want to use.
    `;
    bot.sendMessage(chatId, settingsMessage);
  });

  // /stop command
  bot.onText(/\/stop/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, '👋 Bot stopped. Send /start to restart!');
  });

  // Handle any other text messages
  bot.on('message', (msg) => {
    const chatId = msg.chat.id;

    if (msg.text && msg.text.startsWith('/')) return;
    if (!msg.text) return;

    const responseMessage = `
🤔 I didn't understand that command.

Try these commands:
/start - Get started
/help - See all available commands
/crypto - Learn about cryptocurrencies
/price <symbol> - Get price information
    `;

    bot.sendMessage(chatId, responseMessage);
  });
}

module.exports = {
  registerCommands
};

