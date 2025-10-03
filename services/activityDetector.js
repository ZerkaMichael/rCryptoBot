// Activity Detector Service - Detects unusual market activity and flows
const axios = require('axios');
const config = require('../config/config');
const { formatNumber, getTimeAgoShort, getCoinGeckoId } = require('../utils/helpers');

// Detect all unusual activity
async function detectUnusualActivity(symbol, getCachedCryptoData) {
  try {
    const activities = [];
    const currentData = await getCachedCryptoData(symbol);
    if (!currentData) return [];

    const [
      volumeAnomaly,
      whaleActivity,
      exchangeFlows,
      liquidations,
      tokenActivity,
      largeTrades
    ] = await Promise.all([
      checkVolumeAnomaly(symbol, currentData),
      checkWhaleActivity(symbol, currentData),
      checkExchangeFlows(symbol, currentData),
      checkLiquidationActivity(symbol, currentData),
      checkTokenActivity(symbol),
      detectLargeTradesLast24h(symbol, currentData)
    ]);

    if (volumeAnomaly) activities.push(volumeAnomaly);
    if (whaleActivity.length > 0) activities.push(...whaleActivity);
    if (exchangeFlows.length > 0) activities.push(...exchangeFlows);
    if (liquidations.length > 0) activities.push(...liquidations);
    if (tokenActivity.length > 0) activities.push(...tokenActivity);
    if (largeTrades.length > 0) activities.push(...largeTrades);

    activities.sort((a, b) => {
      const severityOrder = { 'high': 3, 'medium': 2, 'low': 1 };
      const impactOrder = { 'Very High': 4, 'High': 3, 'Medium': 2, 'Low': 1 };
      const aScore = severityOrder[a.severity] + impactOrder[a.impact];
      const bScore = severityOrder[b.severity] + impactOrder[b.impact];
      return bScore - aScore;
    });

    return activities.slice(0, 8);
  } catch (error) {
    console.error('Error detecting unusual activity:', error.message);
    return [];
  }
}

// Check volume anomaly
async function checkVolumeAnomaly(symbol, currentData) {
  try {
    await new Promise(resolve => setTimeout(resolve, 300));
    
    const response = await axios.get(`${config.COINGECKO_API}/coins/${getCoinGeckoId(symbol, config.SYMBOL_MAP)}/market_chart`, {
      params: {
        vs_currency: 'usd',
        days: 14,
        interval: 'daily'
      },
      timeout: 8000
    });

    if (response.data?.total_volumes) {
      const volumes = response.data.total_volumes;
      const recentVolumes = volumes.slice(-7);
      const longerTermVolumes = volumes.slice(-14);

      const avg7DayVolume = recentVolumes.reduce((sum, [_, vol]) => sum + vol, 0) / recentVolumes.length;
      const avg14DayVolume = longerTermVolumes.reduce((sum, [_, vol]) => sum + vol, 0) / longerTermVolumes.length;
      const currentVolume = currentData.volume24h || 0;

      if (currentVolume > avg7DayVolume * 4) {
        const multiplier = (currentVolume / avg7DayVolume).toFixed(1);
        return {
          type: 'extreme_volume_spike',
          severity: 'high',
          description: `Extreme volume spike: $${formatNumber(currentVolume)} (${multiplier}x 7-day average) - institutional accumulation or distribution likely`,
          impact: 'Very High'
        };
      }

      if (currentVolume > avg7DayVolume * 2.5) {
        const multiplier = (currentVolume / avg7DayVolume).toFixed(1);
        return {
          type: 'volume_spike',
          severity: 'medium',
          description: `Volume spike: $${formatNumber(currentVolume)} (${multiplier}x 7-day average) - increased market activity`,
          impact: 'High'
        };
      }

      if (currentVolume < avg7DayVolume * 0.2) {
        const ratio = (currentVolume / avg7DayVolume).toFixed(2);
        return {
          type: 'volume_dry_up',
          severity: 'medium',
          description: `Volume dry-up: $${formatNumber(currentVolume)} (${ratio}x 7-day average) - low liquidity conditions`,
          impact: 'Medium'
        };
      }

      const recentTrend = avg7DayVolume > avg14DayVolume * 1.2 ? 'increasing' : 'decreasing';
      if (recentTrend === 'increasing' && currentVolume > avg7DayVolume * 1.5) {
        return {
          type: 'volume_trend_up',
          severity: 'low',
          description: `Volume trending higher: Current $${formatNumber(currentVolume)} vs 7-day avg $${formatNumber(avg7DayVolume)} - building momentum`,
          impact: 'Medium'
        };
      }
    }
  } catch (error) {
    if (error.response?.status === 429) {
      console.log(`Rate limit hit for volume anomaly check on ${symbol}, skipping...`);
    } else {
      console.log('Error checking volume anomaly:', error.message);
    }
  }
  return null;
}

// Check whale activity
async function checkWhaleActivity(symbol, currentData) {
  try {
    const activities = [];
    const marketCap = currentData.marketCap || 0;

    if (marketCap > 1000000000) {
      activities.push({
        type: 'institutional_interest',
        severity: marketCap > 10000000000 ? 'high' : 'medium',
        description: `${symbol} has $${formatNumber(marketCap)} market cap - likely attracting institutional interest. Large holders may be accumulating.`,
        impact: marketCap > 10000000000 ? 'High' : 'Medium'
      });
    }

    const marketCapChange = currentData.marketCapChange24h || 0;
    if (Math.abs(marketCapChange) > 10) {
      const changeAmount = Math.abs(marketCapChange) / 100 * marketCap;
      const direction = marketCapChange > 0 ? 'gained' : 'lost';

      activities.push({
        type: 'market_cap_volatility',
        severity: Math.abs(marketCapChange) > 20 ? 'high' : 'medium',
        description: `${symbol} market cap ${direction} $${formatNumber(changeAmount)} (${Math.abs(marketCapChange).toFixed(1)}%) in 24h - potential large holder activity`,
        impact: Math.abs(marketCapChange) > 20 ? 'High' : 'Medium'
      });
    }

    return activities;
  } catch (error) {
    console.log('Error checking whale activity:', error.message);
    return [];
  }
}

// Check exchange flows
async function checkExchangeFlows(symbol, currentData) {
  try {
    const activities = [];
    const priceChange = currentData.priceChange24h || 0;
    const volume = currentData.volume24h || 0;
    const marketCap = currentData.marketCap || 0;

    try {
      await new Promise(resolve => setTimeout(resolve, 350));
      
      const exchangeResponse = await axios.get(`${config.COINGECKO_API}/coins/${getCoinGeckoId(symbol, config.SYMBOL_MAP)}/tickers`, {
        timeout: 8000
      });

      if (exchangeResponse.data?.tickers) {
        const tickers = exchangeResponse.data.tickers;
        const exchangeFlows = {};
        
        tickers.forEach(ticker => {
          const exchange = ticker.market.name;
          if (!exchangeFlows[exchange]) {
            exchangeFlows[exchange] = {
              name: exchange,
              volume: 0,
              price: 0,
              count: 0,
              last_traded_at: null
            };
          }

          exchangeFlows[exchange].volume += ticker.volume || 0;
          exchangeFlows[exchange].price = Math.max(exchangeFlows[exchange].price, ticker.last || 0);
          exchangeFlows[exchange].count += 1;

          if (ticker.last_traded_at && (!exchangeFlows[exchange].last_traded_at ||
              new Date(ticker.last_traded_at) > new Date(exchangeFlows[exchange].last_traded_at))) {
            exchangeFlows[exchange].last_traded_at = ticker.last_traded_at;
          }
        });

        const sortedExchanges = Object.values(exchangeFlows)
          .sort((a, b) => b.volume - a.volume)
          .slice(0, 5);

        const totalTopVolume = sortedExchanges.reduce((sum, ex) => sum + ex.volume, 0);
        const flowDirection = priceChange > 0 ? 'inflows' : 'outflows';
        const severity = totalTopVolume > 100000000 ? 'high' : 'medium';

        let flowDetails = `Top exchanges:\n`;
        const topExchanges = sortedExchanges.slice(0, 5);
        topExchanges.forEach((exchange, index) => {
          const volumePercent = ((exchange.volume / totalTopVolume) * 100).toFixed(1);
          flowDetails += `${index + 1}. ${exchange.name}: $${formatNumber(exchange.volume)} ${volumePercent}%\n`;
        });

        activities.push({
          type: 'exchange_flow_detailed',
          severity: severity,
          description: `Major ${flowDirection} detected: $${formatNumber(totalTopVolume)} across top ${topExchanges.length} exchanges. ${flowDetails.trim()}`,
          impact: severity === 'high' ? 'High' : 'Medium',
          rawData: {
            direction: flowDirection,
            totalVolume: totalTopVolume,
            exchanges: topExchanges,
            priceChange: priceChange
          }
        });

        if (sortedExchanges.length > 1) {
          const topExchangeShare = (sortedExchanges[0].volume / totalTopVolume) * 100;
          if (topExchangeShare > 60) {
            activities.push({
              type: 'concentrated_flow',
              severity: 'medium',
              description: `${sortedExchanges[0].name} dominating: ${topExchangeShare.toFixed(1)}% of trading volume - potential institutional activity`,
              impact: 'Medium'
            });
          }
        }
      }
    } catch (error) {
      if (error.response?.status === 429) {
        console.log(`Rate limit hit for exchange flow check on ${symbol}, using fallback...`);
      } else {
        console.log('Error getting exchange ticker data:', error.message);
      }

      const volumeToMcapRatio = marketCap > 0 ? (volume / marketCap) * 100 : 0;

      if (volumeToMcapRatio > 5) {
        const direction = priceChange > 0 ? 'inflows' : 'outflows';
        const severity = volumeToMcapRatio > 10 ? 'high' : 'medium';

        activities.push({
          type: 'exchange_flow_basic',
          severity: severity,
          description: `High exchange activity: $${formatNumber(volume)} traded (${volumeToMcapRatio.toFixed(1)}% of $${formatNumber(marketCap)} market cap) - potential large ${direction}`,
          impact: severity === 'high' ? 'High' : 'Medium'
        });
      }
    }

    try {
      await new Promise(resolve => setTimeout(resolve, 300));
      
      const response = await axios.get(`${config.COINGECKO_API}/coins/${getCoinGeckoId(symbol, config.SYMBOL_MAP)}/market_chart`, {
        params: {
          vs_currency: 'usd',
          days: 7,
          interval: 'daily'
        },
        timeout: 8000
      });

      if (response.data?.total_volumes) {
        const volumes = response.data.total_volumes;
        const recentVolumes = volumes.slice(-7);
        const avgVolume = recentVolumes.reduce((sum, [_, vol]) => sum + vol, 0) / recentVolumes.length;

        if (volume > avgVolume * 3 && volume > 50000000) {
          const multiplier = (volume / avgVolume).toFixed(1);

          activities.push({
            type: 'volume_surge',
            severity: multiplier > 5 ? 'high' : 'medium',
            description: `Volume surge: $${formatNumber(volume)} (${multiplier}x 7-day average of $${formatNumber(avgVolume)}) - major exchange activity`,
            impact: multiplier > 5 ? 'High' : 'Medium'
          });
        }
      }
    } catch (error) {
      if (error.response?.status === 429) {
        console.log(`Rate limit hit for volume history check on ${symbol}, skipping...`);
      } else {
        console.log('Error getting volume history:', error.message);
      }
    }

    return activities;
  } catch (error) {
    console.log('Error checking exchange flows:', error.message);
    return [];
  }
}

// Check liquidation activity
async function checkLiquidationActivity(symbol, currentData) {
  try {
    const activities = [];
    const priceChange24h = currentData.priceChange24h || 0;
    const priceChange7d = currentData.priceChange7d || 0;
    const volume = currentData.volume24h || 0;
    const marketCap = currentData.marketCap || 0;

    const volatilityScore = Math.abs(priceChange24h) + Math.abs(priceChange7d);

    if (volatilityScore > 30 && priceChange24h < -10) {
      const severity = volatilityScore > 50 ? 'high' : 'medium';
      activities.push({
        type: 'liquidation_risk',
        severity: severity,
        description: `Liquidation cascade risk: ${Math.abs(priceChange24h).toFixed(1)}% drop in 24h with ${volatilityScore.toFixed(1)}% total volatility - futures positions may be getting liquidated`,
        impact: severity === 'high' ? 'High' : 'Medium'
      });
    }

    if (Math.abs(priceChange24h) > 20) {
      const direction = priceChange24h > 0 ? 'upward' : 'downward';
      activities.push({
        type: 'price_acceleration',
        severity: Math.abs(priceChange24h) > 30 ? 'high' : 'medium',
        description: `Sudden price acceleration: ${Math.abs(priceChange24h).toFixed(1)}% ${direction} move in 24h - may trigger liquidation cascades in futures markets`,
        impact: Math.abs(priceChange24h) > 30 ? 'High' : 'Medium'
      });
    }

    if (priceChange24h < -15 && volume > marketCap * 0.03) {
      const volumeRatio = (volume / marketCap * 100).toFixed(1);
      activities.push({
        type: 'panic_selling',
        severity: 'high',
        description: `Panic selling detected: ${Math.abs(priceChange24h).toFixed(1)}% drop with ${volumeRatio}% of market cap traded - liquidation risk high`,
        impact: 'High'
      });
    }

    return activities;
  } catch (error) {
    console.log('Error checking liquidation activity:', error.message);
    return [];
  }
}

// Check token activity
async function checkTokenActivity(symbol) {
  try {
    const activities = [];
    await new Promise(resolve => setTimeout(resolve, 400));

    const response = await axios.get(`${config.COINGECKO_API}/coins/${getCoinGeckoId(symbol, config.SYMBOL_MAP)}`, {
      timeout: 8000
    });

    if (response.data) {
      const coinData = response.data;

      if (coinData.market_data?.total_supply && coinData.market_data?.circulating_supply) {
        const burnRate = ((coinData.market_data.total_supply - coinData.market_data.circulating_supply) / coinData.market_data.total_supply) * 100;

        if (burnRate > 20) {
          activities.push({
            type: 'token_burn',
            severity: 'medium',
            description: `${burnRate.toFixed(1)}% of ${symbol} supply has been burned - deflationary pressure`,
            impact: 'Medium'
          });
        }
      }

      const marketCapChange = coinData.market_data?.market_cap_change_percentage_24h;
      if (marketCapChange && Math.abs(marketCapChange) > 15) {
        const direction = marketCapChange > 0 ? 'gained' : 'lost';
        activities.push({
          type: 'market_cap_shift',
          severity: 'high',
          description: `Market cap ${direction} $${formatNumber(Math.abs(coinData.market_data.market_cap_change_24h || 0))} (${Math.abs(marketCapChange).toFixed(1)}%) in 24h`,
          impact: 'High'
        });
      }
    }

    return activities;
  } catch (error) {
    if (error.response?.status === 429) {
      console.log(`Rate limit hit for token activity check on ${symbol}, skipping...`);
    } else {
      console.log('Error checking token activity:', error.message);
    }
    return [];
  }
}

// Detect large trades in last 24h
async function detectLargeTradesLast24h(symbol, currentData) {
  try {
    const activities = [];
    const priceChange24h = parseFloat(currentData.change24h) || 0;
    const volume24h = currentData.volume24h || 0;
    const marketCap = currentData.marketCap || 0;
    
    if (Math.abs(priceChange24h) < 5 && volume24h < marketCap * 0.05) {
      console.log(`Skipping detailed trade analysis for ${symbol} - low activity`);
      return activities;
    }
    
    try {
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const response = await axios.get(`${config.COINGECKO_API}/coins/${getCoinGeckoId(symbol, config.SYMBOL_MAP)}/market_chart`, {
        params: {
          vs_currency: 'usd',
          days: 1,
          interval: 'hourly'
        },
        timeout: 8000
      });

      if (response.data?.prices && response.data?.total_volumes) {
        const prices = response.data.prices;
        const volumes = response.data.total_volumes;
        const movements = [];
        
        for (let i = 1; i < prices.length; i++) {
          const prevPrice = prices[i - 1][1];
          const currentPrice = prices[i][1];
          const timestamp = prices[i][0];
          const volume = volumes[i][1];
          const priceChange = currentPrice - prevPrice;
          const priceChangePercent = (priceChange / prevPrice) * 100;
          const impactScore = Math.abs(priceChangePercent) * Math.sqrt(volume / 1000000);

          movements.push({
            timestamp: new Date(timestamp),
            priceChange,
            priceChangePercent,
            price: currentPrice,
            volume,
            impactScore,
            type: priceChange > 0 ? 'BUY' : 'SELL'
          });
        }

        const buys = movements
          .filter(m => m.type === 'BUY' && m.priceChangePercent > 0.5)
          .sort((a, b) => b.impactScore - a.impactScore)
          .slice(0, 3);

        const sells = movements
          .filter(m => m.type === 'SELL' && m.priceChangePercent < -0.5)
          .sort((a, b) => b.impactScore - a.impactScore)
          .slice(0, 3);

        if (buys.length > 0) {
          let buyDescription = `Top ${buys.length} BUYS (24h):\n`;
          buys.forEach((buy, index) => {
            const timeAgo = getTimeAgoShort(buy.timestamp);
            buyDescription += `${index + 1}. +${buy.priceChangePercent.toFixed(2)}% ($${formatNumber(buy.volume)} vol) ${timeAgo}\n`;
          });
          
          activities.push({
            type: 'large_buys_24h',
            severity: buys[0].priceChangePercent > 5 ? 'high' : 'medium',
            description: buyDescription.trim(),
            impact: buys[0].priceChangePercent > 5 ? 'High' : 'Medium',
            rawData: buys
          });
        }

        if (sells.length > 0) {
          let sellDescription = `Top ${sells.length} SELLS (24h):\n`;
          sells.forEach((sell, index) => {
            const timeAgo = getTimeAgoShort(sell.timestamp);
            sellDescription += `${index + 1}. ${sell.priceChangePercent.toFixed(2)}% ($${formatNumber(sell.volume)} vol) ${timeAgo}\n`;
          });
          
          activities.push({
            type: 'large_sells_24h',
            severity: sells[0].priceChangePercent < -5 ? 'high' : 'medium',
            description: sellDescription.trim(),
            impact: sells[0].priceChangePercent < -5 ? 'High' : 'Medium',
            rawData: sells
          });
        }

        const totalBuyVolume = movements.filter(m => m.type === 'BUY').reduce((sum, m) => sum + m.volume, 0);
        const totalSellVolume = movements.filter(m => m.type === 'SELL').reduce((sum, m) => sum + m.volume, 0);
        const netFlow = totalBuyVolume - totalSellVolume;
        const flowDirection = netFlow > 0 ? 'net buying' : 'net selling';

        if (Math.abs(netFlow) > currentData.volume24h * 0.1) {
          activities.push({
            type: 'net_flow_24h',
            severity: 'medium',
            description: `24h ${flowDirection} pressure: $${formatNumber(Math.abs(netFlow))} (Buy: $${formatNumber(totalBuyVolume)}, Sell: $${formatNumber(totalSellVolume)})`,
            impact: 'Medium'
          });
        }
      }
    } catch (apiError) {
      if (apiError.response?.status === 401 || apiError.response?.status === 429) {
        console.log(`API limit hit for ${symbol}, using fallback analysis...`);
        
        if (Math.abs(priceChange24h) > 3) {
          const direction = priceChange24h > 0 ? 'buying' : 'selling';
          const pressure = priceChange24h > 0 ? 'bullish' : 'bearish';
          
          activities.push({
            type: 'estimated_flow_24h',
            severity: Math.abs(priceChange24h) > 5 ? 'high' : 'medium',
            description: `Strong ${direction} pressure detected: ${priceChange24h > 0 ? '+' : ''}${priceChange24h.toFixed(2)}% move with $${formatNumber(volume24h)} volume - ${pressure} sentiment`,
            impact: Math.abs(priceChange24h) > 5 ? 'High' : 'Medium'
          });
        }
      } else {
        throw apiError;
      }
    }

    return activities;
  } catch (error) {
    console.log('Error detecting large trades:', error.message);
    return [];
  }
}

module.exports = {
  detectUnusualActivity,
  checkVolumeAnomaly,
  checkWhaleActivity,
  checkExchangeFlows,
  checkLiquidationActivity,
  checkTokenActivity,
  detectLargeTradesLast24h
};

