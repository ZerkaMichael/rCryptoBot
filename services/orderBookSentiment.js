const axios = require('axios');

const MAX_LEVELS = 50;

function sanitizeSymbol(symbol) {
  return (symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function determineSentiment(score) {
  if (!Number.isFinite(score)) {
    return 'Neutral';
  }
  if (score >= 0.25) return 'Strongly Bullish';
  if (score >= 0.1) return 'Bullish';
  if (score <= -0.25) return 'Strongly Bearish';
  if (score <= -0.1) return 'Bearish';
  return 'Neutral';
}

function summarizeDepth(bids, asks) {
  if (!Array.isArray(bids) || !Array.isArray(asks) || bids.length === 0 || asks.length === 0) {
    return null;
  }

  const topBids = bids.slice(0, MAX_LEVELS);
  const topAsks = asks.slice(0, MAX_LEVELS);

  let bidVolume = 0;
  let askVolume = 0;

  for (const [price, quantity] of topBids) {
    const p = parseFloat(price);
    const q = parseFloat(quantity);
    if (Number.isFinite(p) && Number.isFinite(q)) {
      bidVolume += p * q;
    }
  }

  for (const [price, quantity] of topAsks) {
    const p = parseFloat(price);
    const q = parseFloat(quantity);
    if (Number.isFinite(p) && Number.isFinite(q)) {
      askVolume += p * q;
    }
  }

  if (bidVolume === 0 && askVolume === 0) {
    return null;
  }

  const totalVolume = bidVolume + askVolume || 1;
  const imbalance = (bidVolume - askVolume) / totalVolume;
  const topBid = topBids[0];
  const topAsk = topAsks[0];
  const topBidPrice = parseFloat(topBid?.[0]);
  const topAskPrice = parseFloat(topAsk?.[0]);
  const spreadPercent = Number.isFinite(topBidPrice) && Number.isFinite(topAskPrice) && topAskPrice > 0
    ? (topAskPrice - topBidPrice) / topAskPrice
    : null;

  return {
    sentiment: determineSentiment(imbalance),
    imbalance,
    bidVolumeUsd: bidVolume,
    askVolumeUsd: askVolume,
    bidSharePercent: (bidVolume / totalVolume) * 100,
    askSharePercent: (askVolume / totalVolume) * 100,
    spreadPercent,
    topBid: {
      price: topBidPrice,
      quantity: parseFloat(topBid?.[1]) || 0
    },
    topAsk: {
      price: topAskPrice,
      quantity: parseFloat(topAsk?.[1]) || 0
    },
    levelsEvaluated: {
      bids: topBids.length,
      asks: topAsks.length
    }
  };
}

async function fetchFromBinance(symbol) {
  const candidatePairs = [
    `${symbol}USDT`,
    `${symbol}BUSD`,
    `${symbol}USDC`
  ];

  for (const pair of candidatePairs) {
    try {
      const response = await axios.get('https://api.binance.com/api/v3/depth', {
        params: { symbol: pair, limit: MAX_LEVELS },
        timeout: 4000
      });

      const summary = summarizeDepth(response.data?.bids, response.data?.asks);
      if (summary) {
        return { exchange: 'Binance', pair, ...summary };
      }
    } catch (error) {
      if (error.response?.status === 429) {
        throw new Error('Binance rate limit exceeded');
      }
      // Invalid trading pairs return HTTP 400; try the next candidate.
    }
  }

  return null;
}

async function fetchFromKuCoin(symbol) {
  const candidatePairs = [
    `${symbol}-USDT`,
    `${symbol}-USDC`,
    `${symbol}-BTC`
  ];

  for (const pair of candidatePairs) {
    try {
      const response = await axios.get('https://api.kucoin.com/api/v1/market/orderbook/level2_20', {
        params: { symbol: pair },
        timeout: 4000
      });

      const data = response.data?.data;
      const summary = summarizeDepth(data?.bids, data?.asks);
      if (summary) {
        return { exchange: 'KuCoin', pair, ...summary };
      }
    } catch (error) {
      if (error.response?.status === 429) {
        throw new Error('KuCoin rate limit exceeded');
      }
    }
  }

  return null;
}

async function fetchFromGateIo(symbol) {
  const candidatePairs = [
    `${symbol}_USDT`,
    `${symbol}_USDC`,
    `${symbol}_BTC`
  ];

  for (const pair of candidatePairs) {
    try {
      const response = await axios.get('https://api.gateio.ws/api/v4/spot/order_book', {
        params: { currency_pair: pair, limit: MAX_LEVELS },
        headers: { 'Accept': 'application/json' },
        timeout: 4000
      });

      const summary = summarizeDepth(response.data?.bids, response.data?.asks);
      if (summary) {
        return { exchange: 'Gate.io', pair, ...summary };
      }
    } catch (error) {
      if (error.response?.status === 429) {
        throw new Error('Gate.io rate limit exceeded');
      }
    }
  }

  return null;
}

async function analyzeOrderBook(symbol) {
  const sanitizedSymbol = sanitizeSymbol(symbol);
  if (!sanitizedSymbol) {
    return null;
  }

  const fetchers = [fetchFromBinance, fetchFromKuCoin, fetchFromGateIo];

  for (const fetcher of fetchers) {
    try {
      const result = await fetcher(sanitizedSymbol);
      if (result) {
        return {
          symbol: sanitizedSymbol,
          ...result
        };
      }
    } catch (error) {
      console.log(`Order book fetch error (${sanitizedSymbol}):`, error.message);
    }
  }

  return null;
}

module.exports = {
  analyzeOrderBook
};
