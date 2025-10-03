// Alerts Service - Price alerts and auto-volatility monitoring
const axios = require('axios');
const config = require('../config/config');
const { formatNumber, getCoinGeckoId } = require('../utils/helpers');

// Storage
const priceAlerts = {};
const autoAlerts = {
  enabled: {},
  baselines: {},
  cooldown: config.AUTO_ALERT_COOLDOWN,
  threshold: config.AUTO_ALERT_THRESHOLD
};

// Check auto-volatility alerts
async function checkAutoVolatilityAlerts(bot, realtimePrices) {
  const trackedSymbols = Array.from(realtimePrices.keys());
  
  if (trackedSymbols.length === 0) return;
  
  for (const symbol of trackedSymbols) {
    try {
      const currentData = realtimePrices.get(symbol);
      if (!currentData) continue;

      const currentPrice = currentData.price;
      const now = Date.now();

      // Initialize baseline
      if (!autoAlerts.baselines[symbol]) {
        autoAlerts.baselines[symbol] = {
          price: currentPrice,
          timestamp: now,
          lastAlertPrice: currentPrice,
          lastAlertTime: 0
        };
        continue;
      }

      const baseline = autoAlerts.baselines[symbol];
      const priceChangePercent = ((currentPrice - baseline.lastAlertPrice) / baseline.lastAlertPrice) * 100;

      // Check threshold and cooldown
      if (Math.abs(priceChangePercent) >= autoAlerts.threshold && 
          now - baseline.lastAlertTime > autoAlerts.cooldown) {
        
        const direction = priceChangePercent > 0 ? 'UP' : 'DOWN';
        const emoji = priceChangePercent > 0 ? '📈' : '📉';
        
        // Send to enabled users
        for (const chatId in autoAlerts.enabled) {
          if (autoAlerts.enabled[chatId]) {
            const message = `🚨 **VOLATILITY ALERT**\n\n` +
              `${emoji} **${symbol}** ${direction} ${Math.abs(priceChangePercent).toFixed(1)}%\n\n` +
              `**$${formatNumber(currentPrice)}**\n` +
              `(was $${formatNumber(baseline.lastAlertPrice)})\n` +
              `Change: ${priceChangePercent > 0 ? '+' : ''}$${Math.abs(currentPrice - baseline.lastAlertPrice).toFixed(2)}\n\n` +
              `💡 /price ${symbol} for details`;

            try {
              await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
              console.log(`✅ Volatility alert sent: ${symbol} ${direction} ${Math.abs(priceChangePercent).toFixed(1)}% to chat ${chatId}`);
            } catch (error) {
              console.error(`Error sending volatility alert to ${chatId}:`, error.message);
            }
          }
        }

        baseline.lastAlertPrice = currentPrice;
        baseline.lastAlertTime = now;
      }

      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (error) {
      console.error(`Error checking volatility for ${symbol}:`, error.message);
    }
  }
}

// Generate alert analysis
async function generateAlertAnalysis(alert, currentData, originalPrice) {
  try {
    const analysis = {
      direction: alert.targetPrice > originalPrice ? 'upward' : 'downward',
      priceChange: currentData.price - originalPrice,
      percentChange: ((currentData.price - originalPrice) / originalPrice) * 100,
      timeToTrigger: Date.now() - alert.timestamp.getTime(),
      marketContext: {},
      newsContext: [],
      unusualActivity: []
    };

    const hoursElapsed = analysis.timeToTrigger / (1000 * 60 * 60);
    analysis.priceVelocity = analysis.priceChange / hoursElapsed;
    analysis.percentVelocity = analysis.percentChange / hoursElapsed;

    // Get market context
    try {
      const response = await axios.get(`${config.COINGECKO_API}/coins/${getCoinGeckoId(alert.symbol, config.SYMBOL_MAP)}`, {
        timeout: 5000
      });

      if (response.data) {
        const coinData = response.data;
        analysis.marketContext = {
          marketCap: coinData.market_data?.market_cap?.usd,
          volume24h: coinData.market_data?.total_volume?.usd,
          marketCapRank: coinData.market_cap_rank,
          priceChange24h: coinData.market_data?.price_change_percentage_24h,
          priceChange7d: coinData.market_data?.price_change_percentage_7d,
          priceChange30d: coinData.market_data?.price_change_percentage_30d
        };

        const avgVolume = coinData.market_data?.total_volume?.usd;
        const currentVolume = currentData.volume24h || avgVolume;
        if (currentVolume && avgVolume && currentVolume > avgVolume * 2) {
          analysis.unusualActivity.push(`Unusual volume spike: ${formatNumber(currentVolume)} (2x normal)`);
        }
      }
    } catch (error) {
      console.log('Error getting market context:', error.message);
    }

    // Sentiment from market data
    if (analysis.marketContext.priceChange24h) {
      const change24h = analysis.marketContext.priceChange24h;
      if (change24h > 5) {
        analysis.sentimentContext = 'bullish';
      } else if (change24h < -5) {
        analysis.sentimentContext = 'bearish';
      }
    }

    return analysis;
  } catch (error) {
    console.error('Error generating alert analysis:', error.message);
    return {
      direction: alert.targetPrice > originalPrice ? 'upward' : 'downward',
      error: 'Analysis unavailable'
    };
  }
}

// Generate alert message
function generateAlertMessage(alert, analysis) {
  const direction = analysis.direction;
  const symbol = alert.symbol;
  const targetPrice = formatNumber(alert.targetPrice);
  const currentPrice = formatNumber(alert.triggerPrice);
  const percentChange = Math.abs(analysis.percentChange).toFixed(2);
  const priceChangeAmount = Math.abs(alert.triggerPrice - alert.currentPrice).toFixed(2);

  let message = `🚨 **${symbol} ALERT**\n\n`;

  if (direction === 'upward') {
    message += `📈 **${symbol}** hit your target!\n`;
    message += `**$${currentPrice}** (Target: $${targetPrice})\n`;
    message += `+${percentChange}% (+$${priceChangeAmount})\n\n`;
  } else {
    message += `📉 **${symbol}** hit your target!\n`;
    message += `**$${currentPrice}** (Target: $${targetPrice})\n`;
    message += `-${percentChange}% (-$${priceChangeAmount})\n\n`;
  }

  if (!analysis.error && analysis.timeToTrigger > 3600000) {
    const hoursElapsed = (analysis.timeToTrigger / (1000 * 60 * 60)).toFixed(1);
    message += `⏱ Triggered after ${hoursElapsed}h\n\n`;
  }

  if (analysis.marketContext?.priceChange24h) {
    const change24h = analysis.marketContext.priceChange24h;
    if (Math.abs(change24h) > 5) {
      const emoji = change24h > 0 ? '📈' : '📉';
      message += `${emoji} 24h: ${change24h > 0 ? '+' : ''}${change24h.toFixed(1)}%\n`;
    }
  }

  if (analysis.unusualActivity && analysis.unusualActivity.length > 0) {
    message += `⚠️ ${analysis.unusualActivity[0]}\n`;
  }

  if (analysis.sentimentContext && analysis.sentimentContext !== 'neutral') {
    const emoji = analysis.sentimentContext === 'bullish' ? '🐂' : '🐻';
    message += `${emoji} ${analysis.sentimentContext.charAt(0).toUpperCase() + analysis.sentimentContext.slice(1)} community sentiment\n`;
  }

  message += `\n💡 `;
  if (direction === 'upward') {
    message += `Target reached! Consider taking profits or setting a trailing stop.`;
  } else {
    message += `Target reached! Review your position and risk management.`;
  }

  return message;
}

// Check all alerts
async function checkAlerts(bot, getCachedCryptoData, realtimePrices) {
  try {
    console.log(`🔍 Checking alerts for ${Object.keys(priceAlerts).length} users...`);

    await checkAutoVolatilityAlerts(bot, realtimePrices);

    for (const chatId in priceAlerts) {
      const userAlerts = priceAlerts[chatId].filter(alert => alert.status === 'active');
      console.log(`User ${chatId}: ${userAlerts.length} active alerts`);

      for (const alert of userAlerts) {
        try {
          const currentData = await getCachedCryptoData(alert.symbol, true);

          if (!currentData) {
            console.log(`❌ No price data for ${alert.symbol}`);
            continue;
          }

          const currentPrice = currentData.price;
          const targetPrice = alert.targetPrice;
          const originalPrice = alert.currentPrice;

          console.log(`📊 ${alert.symbol}: Current: $${currentPrice.toFixed(2)}, Target: $${targetPrice.toFixed(2)}, Original: $${originalPrice.toFixed(2)}`);

          const shouldTrigger = (alert.targetPrice > originalPrice && currentPrice >= alert.targetPrice) ||
                               (alert.targetPrice < originalPrice && currentPrice <= alert.targetPrice);

          console.log(`🎯 ${alert.symbol} should trigger: ${shouldTrigger}`);

          if (shouldTrigger) {
            console.log(`🚨 ALERT TRIGGERING for ${alert.symbol}!`);

            alert.status = 'triggered';
            alert.triggerTime = new Date();
            alert.triggerPrice = currentPrice;

            const analysis = await generateAlertAnalysis(alert, currentData, originalPrice);
            const alertMessage = generateAlertMessage(alert, analysis);

            await bot.sendMessage(chatId, alertMessage, { parse_mode: 'Markdown' });

            console.log(`✅ Alert sent for ${alert.symbol} in chat ${chatId}`);
          }
          
          if (userAlerts.indexOf(alert) < userAlerts.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        } catch (error) {
          console.error(`Error checking alert for ${alert.symbol}:`, error.message);
        }
      }
    }
  } catch (error) {
    console.error('Error in alert checking system:', error.message);
  }
}

// Start monitoring
function startAlertMonitoring(bot, getCachedCryptoData, getRealtimePrices) {
  setInterval(() => {
    checkAlerts(bot, getCachedCryptoData, getRealtimePrices());
  }, config.ALERT_CHECK_INTERVAL);
  
  console.log('🤖 Alert monitoring system started...');
}

// Getters/Setters
function getPriceAlerts() {
  return priceAlerts;
}

function getAutoAlerts() {
  return autoAlerts;
}

module.exports = {
  checkAlerts,
  checkAutoVolatilityAlerts,
  generateAlertAnalysis,
  generateAlertMessage,
  startAlertMonitoring,
  getPriceAlerts,
  getAutoAlerts
};

