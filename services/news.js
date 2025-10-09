// News Service - Aggregates and analyzes cryptocurrency news from multiple sources
const axios = require('axios');
const cheerio = require('cheerio');
const OpenAI = require('openai');
const config = require('../config/config');
const { getCoinGeckoId } = require('../utils/helpers');
const activityDetector = require('./activityDetector');
const orderBookSentiment = require('./orderBookSentiment');

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY
});

// News source configurations
const NEWS_SOURCES = {
  CRYPTOCOMPARE: 'https://min-api.cryptocompare.com/data/v2/news/',
  CRYPTOPANIC: 'https://cryptopanic.com/api/developer/v2',
  RSS_FEEDS: [
    { name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
    { name: 'CoinTelegraph', url: 'https://cointelegraph.com/rss' },
    { name: 'Decrypt', url: 'https://decrypt.co/feed' },
    { name: 'CryptoSlate', url: 'https://cryptoslate.com/feed/' }
  ]
};

const SYMBOL_CONTEXT_CACHE = new Map();

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildKeywordPatterns(keywords) {
  return keywords
    .filter(Boolean)
    .map((rawKeyword) => {
      const keyword = rawKeyword.trim();
      if (!keyword) {
        return null;
      }

      const lowerKeyword = keyword.toLowerCase();

      if (lowerKeyword.length <= 4 && !/\s/.test(lowerKeyword)) {
        const escaped = escapeRegex(lowerKeyword);
        return new RegExp(`(^|[^a-z0-9])${escaped}(?:\\b|\\/|\\-|usd|usdt|usdc)?`, 'i');
      }

      const escaped = escapeRegex(lowerKeyword)
        .replace(/\\\s+/g, '\\s+')
        .replace(/\\\-+/g, '[\\s\\-]+');

      return new RegExp(`\\b${escaped}\\b`, 'i');
    })
    .filter(Boolean);
}

function buildTwitterKeywords(symbol, name, slug) {
  const keywords = new Set();
  const normalizedSymbol = symbol.toUpperCase();
  const symbolLower = normalizedSymbol.toLowerCase();

  keywords.add(normalizedSymbol);
  keywords.add(symbolLower);
  keywords.add(`#${symbolLower}`);
  keywords.add(`$${normalizedSymbol}`);
  keywords.add(`${symbolLower}/usd`);
  keywords.add(`${symbolLower}-usd`);

  if (name) {
    keywords.add(name);
    keywords.add(name.toLowerCase());
  }

  if (slug) {
    keywords.add(slug);
    keywords.add(slug.replace(/-/g, ' '));
  }

  return Array.from(keywords).filter(Boolean).slice(0, 8);
}

async function getSymbolContext(symbol) {
  const cacheKey = symbol.toUpperCase();
  if (SYMBOL_CONTEXT_CACHE.has(cacheKey)) {
    return SYMBOL_CONTEXT_CACHE.get(cacheKey);
  }

  const slug = getCoinGeckoId(symbol, config.SYMBOL_MAP);
  const keywords = new Set();
  keywords.add(symbol.toLowerCase());

  if (slug) {
    keywords.add(slug.toLowerCase());
    if (slug.includes('-')) {
      keywords.add(slug.replace(/-/g, ' '));
      slug.split('-').forEach((part) => {
        if (part.length > 2) {
          keywords.add(part.toLowerCase());
        }
      });
    }
  }

  let primaryName = '';

  if (slug) {
    try {
      const response = await axios.get(`${config.COINGECKO_API}/coins/${slug}`, {
        params: {
          localization: false,
          tickers: false,
          market_data: false,
          community_data: false,
          developer_data: false,
          sparkline: false
        },
        timeout: 5000
      });

      const coinData = response.data;
      if (coinData) {
        if (coinData.name) {
          primaryName = coinData.name;
          keywords.add(coinData.name.toLowerCase());
          coinData.name
            .toLowerCase()
            .split(/\s+/)
            .forEach((part) => {
              if (part.length > 3) {
                keywords.add(part);
              }
            });
        }

        if (coinData.symbol) {
          keywords.add(coinData.symbol.toLowerCase());
        }

        if (Array.isArray(coinData.categories)) {
          coinData.categories.forEach((category) => {
            if (category) {
              const normalizedCategory = category.toLowerCase();
              if (
                normalizedCategory.includes(slug.toLowerCase()) ||
                (primaryName && normalizedCategory.includes(primaryName.toLowerCase()))
              ) {
                keywords.add(normalizedCategory);
              }
            }
          });
        }
      }
    } catch (error) {
      console.log(`Error fetching symbol context for ${symbol}:`, error.message);
    }
  }

  const keywordList = Array.from(keywords).filter(Boolean);
  const context = {
    symbol: cacheKey,
    coinId: slug,
    name: primaryName || cacheKey,
    keywords: keywordList,
    keywordPatterns: buildKeywordPatterns(keywordList),
    twitterKeywords: buildTwitterKeywords(cacheKey, primaryName, slug)
  };
  context.primarySearchTerm = primaryName || (slug ? slug.replace(/-/g, ' ') : cacheKey);

  SYMBOL_CONTEXT_CACHE.set(cacheKey, context);
  return context;
}

function matchesSymbolText(text, symbolContext) {
  if (!text || !symbolContext) {
    return false;
  }

  return symbolContext.keywordPatterns.some((pattern) => pattern.test(text));
}

function formatLiquidityNumber(value) {
  if (!Number.isFinite(value) || value === 0) {
    return '0';
  }
  const absValue = Math.abs(value);
  if (absValue >= 1e9) {
    return `${(value / 1e9).toFixed(2)}B`;
  }
  if (absValue >= 1e6) {
    return `${(value / 1e6).toFixed(2)}M`;
  }
  if (absValue >= 1e3) {
    return `${(value / 1e3).toFixed(2)}K`;
  }
  if (absValue >= 1) {
    return value.toFixed(2);
  }
  return value.toPrecision(2);
}

function formatOrderBookPrice(value) {
  if (!Number.isFinite(value)) {
    return 'N/A';
  }
  if (Math.abs(value) >= 100) {
    return value.toFixed(2);
  }
  if (Math.abs(value) >= 1) {
    return value.toFixed(4);
  }
  return value.toPrecision(4);
}

function formatOrderBookQuantity(value) {
  if (!Number.isFinite(value)) {
    return 'N/A';
  }
  if (value >= 1000) {
    return value.toFixed(0);
  }
  if (value >= 1) {
    return value.toFixed(2);
  }
  return value.toPrecision(3);
}

// Get quality Reddit news
async function getQualityRedditNews(symbol, symbolContext) {
  try {
    const context = symbolContext || await getSymbolContext(symbol);
    const premiumSubreddits = [
      { name: 'cryptocurrency', quality: 8, minScore: 100, minComments: 20 },
      { name: 'CryptoMarkets', quality: 10, minScore: 50, minComments: 15 },
      { name: 'Bitcoin', quality: 9, minScore: 75, minComments: 15 },
      { name: 'ethereum', quality: 9, minScore: 75, minComments: 15 },
      { name: 'defi', quality: 8, minScore: 50, minComments: 10 },
      { name: 'CryptoCurrencyTrading', quality: 7, minScore: 40, minComments: 10 },
      { name: symbol.toLowerCase(), quality: 6, minScore: 30, minComments: 5 }
    ];

    if (context.coinId) {
      const coinIdSub = context.coinId.replace(/-/g, '');
      premiumSubreddits.push({ name: coinIdSub, quality: 6, minScore: 20, minComments: 5 });
    }
    if (context.name && context.name.length < 25) {
      const nameSub = context.name.replace(/\s+/g, '');
      premiumSubreddits.push({ name: nameSub.toLowerCase(), quality: 6, minScore: 20, minComments: 5 });
    }

    const subredditQueue = [];
    const seenSubreddits = new Set();
    premiumSubreddits.forEach((subredditInfo) => {
      const key = subredditInfo.name?.toLowerCase();
      if (!key || seenSubreddits.has(key)) {
        return;
      }
      seenSubreddits.add(key);
      subredditQueue.push(subredditInfo);
    });
    
    const qualityNewsItems = [];
    
    for (const subredditInfo of subredditQueue) {
      const subreddit = subredditInfo.name;
      try {
        const [hotResponse, topResponse] = await Promise.all([
          axios.get(`https://www.reddit.com/r/${subreddit}/hot.json`, {
            params: { limit: 30 },
            headers: { 'User-Agent': 'rCryptoBot/1.0' }
          }),
          axios.get(`https://www.reddit.com/r/${subreddit}/top.json`, {
            params: { limit: 30, t: 'week' },
            headers: { 'User-Agent': 'rCryptoBot/1.0' }
          })
        ]);
        
        const allPosts = [
          ...(hotResponse.data?.data?.children || []),
          ...(topResponse.data?.data?.children || [])
        ];
        
        for (const post of allPosts) {
          const postData = post.data;
          const matchesSymbol = matchesSymbolText(postData.title, context) ||
                                matchesSymbolText(postData.selftext, context);
          
          if (postData.title &&
              matchesSymbol &&
              postData.score >= subredditInfo.minScore &&
              postData.num_comments >= subredditInfo.minComments &&
              !postData.over_18 &&
              !postData.removed &&
              postData.upvote_ratio > 0.75 &&
              !isMemeOrLowQuality(postData) &&
              isSubstantiveDiscussion(postData)) {
            
            const content = await getRedditPostContent(postData.permalink);
            
            qualityNewsItems.push({
              title: postData.title,
              content: content,
              url: `https://reddit.com${postData.permalink}`,
              source: `r/${subreddit}`,
              score: postData.score,
              created: new Date(postData.created_utc * 1000),
              comments: postData.num_comments,
              upvoteRatio: postData.upvote_ratio,
              author: postData.author,
              type: 'reddit_quality',
              qualityScore: calculateEnhancedQualityScore(postData, subredditInfo.quality),
              flair: postData.link_flair_text || '',
              isDiscussion: postData.link_flair_text?.toLowerCase().includes('discussion') || false
            });
          }
        }
      } catch (error) {
        console.log(`Error fetching quality posts from r/${subreddit}:`, error.message);
      }
    }
    
    return qualityNewsItems
      .sort((a, b) => b.qualityScore - a.qualityScore)
      .slice(0, 8);
      
  } catch (error) {
    console.error('Error fetching quality Reddit news:', error.message);
    return [];
  }
}

// Helper functions for Reddit quality filtering
function isMemeOrLowQuality(postData) {
  const title = postData.title.toLowerCase();
  const selftext = (postData.selftext || '').toLowerCase();
  
  const memeIndicators = [
    'moon', 'lambo', 'wen', 'hodl', 'diamond hands', '💎🙌', '🚀', 
    'to the moon', 'wagmi', 'ngmi', 'lfg', 'gm', 'ser', 'fren',
    'ape', 'degen', 'chad', 'virgin', 'based', 'cringe', 'cope',
    'meme', 'joke', 'funny', 'lol', 'lmao', 'rofl', 'comedy',
    'shitpost', 'shitcoin', 'pump', 'dump', 'rug', 'scam'
  ];
  
  const flair = (postData.link_flair_text || '').toLowerCase();
  if (flair.includes('meme') || flair.includes('comedy') || flair.includes('fun')) {
    return true;
  }
  
  const memeCount = memeIndicators.filter(indicator => title.includes(indicator)).length;
  if (memeCount >= 2) return true;
  
  const emojiRegex = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu;
  const emojiMatches = title.match(emojiRegex);
  if (emojiMatches && emojiMatches.length > 3) return true;
  
  const words = title.split(' ');
  const capsWords = words.filter(word => word.length > 3 && word === word.toUpperCase());
  if (capsWords.length > words.length * 0.5) return true;
  
  if (title.length < 20 && !selftext) return true;
  
  if ((title.includes('$') || title.includes('price')) && 
      (title.includes('eoy') || title.includes('prediction') || title.includes('target')) &&
      (!selftext || selftext.length < 100)) {
    return true;
  }
  
  return false;
}

function isSubstantiveDiscussion(postData) {
  const selftext = postData.selftext || '';
  const title = postData.title || '';
  
  const qualityIndicators = [
    'analysis', 'technical', 'fundamental', 'research', 'dd', 'due diligence',
    'whitepaper', 'tokenomics', 'roadmap', 'development', 'update', 'news',
    'partnership', 'integration', 'adoption', 'use case', 'utility',
    'comparison', 'versus', 'pros and cons', 'discussion', 'thoughts'
  ];
  
  const hasQualityIndicators = qualityIndicators.some(indicator => 
    title.toLowerCase().includes(indicator) || selftext.toLowerCase().includes(indicator)
  );
  
  const hasSubstantiveContent = selftext.length > 200;
  const hasLinks = selftext.includes('http://') || selftext.includes('https://');
  const engagementRatio = postData.num_comments / Math.max(postData.score, 1);
  const hasGoodEngagement = engagementRatio > 0.1;
  
  return hasQualityIndicators || (hasSubstantiveContent && hasGoodEngagement) || 
         (hasLinks && postData.num_comments > 20);
}

function calculateEnhancedQualityScore(postData, subredditQuality) {
  const baseScore = postData.score || 0;
  const commentWeight = (postData.num_comments || 0) * 3;
  const ratioBonus = (postData.upvote_ratio || 0) * 150;
  const timeDecay = Math.max(0, 1 - (Date.now() - postData.created_utc * 1000) / (7 * 24 * 60 * 60 * 1000));
  const flairBonus = postData.link_flair_text?.toLowerCase().includes('discussion') ? 50 : 0;
  const contentBonus = Math.min((postData.selftext?.length || 0) / 10, 100);
  const subredditMultiplier = 1 + (subredditQuality / 10);
  const engagementQuality = Math.min((postData.num_comments / Math.max(postData.score, 1)) * 100, 50);
  
  const totalScore = (baseScore + commentWeight + ratioBonus + flairBonus + contentBonus + engagementQuality) * 
                     (1 + timeDecay * 0.3) * subredditMultiplier;
  
  return totalScore;
}

async function getRedditPostContent(permalink) {
  try {
    const response = await axios.get(`https://www.reddit.com${permalink}.json`, {
      headers: { 'User-Agent': 'rCryptoBot/1.0' },
      timeout: 3000
    });
    
    if (response.data && response.data[0]?.data?.children?.[0]?.data) {
      const postData = response.data[0].data.children[0].data;
      let content = postData.selftext || '';
      
      if (response.data[1]?.data?.children) {
        const topComments = response.data[1].data.children
          .slice(0, 3)
          .map(comment => comment.data?.body)
          .filter(body => body && body !== '[deleted]' && body !== '[removed]')
          .join(' ');
        
        if (topComments) {
          content += ' Top comments: ' + topComments;
        }
      }
      
      return content.substring(0, 1000);
    }
  } catch (error) {
    console.log('Error fetching post content:', error.message);
  }
  return '';
}

// Get news from CryptoCompare API
async function getCryptoCompareNews(symbol, symbolContext) {
  try {
    const context = symbolContext || await getSymbolContext(symbol);
    const response = await axios.get(`${NEWS_SOURCES.CRYPTOCOMPARE}?lang=EN`, {
      timeout: 5000,
      headers: { 'User-Agent': 'rCryptoBot/1.0' }
    });

    if (response.data && response.data.Data) {
      const relevantNews = response.data.Data
        .filter(article => {
          const categories = article.categories?.replace(/\|/g, ' ') || '';
          return matchesSymbolText(article.title, context) ||
                 matchesSymbolText(article.body, context) ||
                 matchesSymbolText(categories, context);
        })
        .slice(0, 5)
        .map(article => ({
          title: article.title,
          content: article.body?.substring(0, 500) || '',
          url: article.url || article.guid,
          source: 'CryptoCompare',
          publishedAt: new Date(article.published_on * 1000),
          imageUrl: article.imageurl,
          type: 'news_api',
          categories: article.categories?.split('|') || []
        }));

      return relevantNews;
    }
  } catch (error) {
    console.log('Error fetching CryptoCompare news:', error.message);
  }
  return [];
}

// Get news from CryptoPanic API v2
async function getCryptoPanicNews(symbol, symbolContext) {
  try {
    // CryptoPanic requires API key - skip if not configured
    if (!config.CRYPTOPANIC_API_KEY) {
      return [];
    }

    const context = symbolContext || await getSymbolContext(symbol);
    const currencies = new Set();
    currencies.add(symbol.toLowerCase());
    if (context.coinId) {
      currencies.add(context.coinId.toLowerCase());
    }
    
    const response = await axios.get(`${NEWS_SOURCES.CRYPTOPANIC}/posts/`, {
      params: {
        auth_token: config.CRYPTOPANIC_API_KEY,
        currencies: Array.from(currencies).join(','),
        kind: 'news',
        public: 'true'
      },
      timeout: 5000,
      headers: { 'User-Agent': 'rCryptoBot/1.0' }
    });

    if (response.data && response.data.results) {
      return response.data.results
        .filter(article => matchesSymbolText(article.title, context) ||
                           matchesSymbolText(article.description, context) ||
                           matchesSymbolText(article.metadata?.coins?.map(c => c?.code).join(' '), context))
        .slice(0, 8)
        .map(article => ({
          title: article.title,
          content: article.title,
          url: article.url,
          source: article.source?.title || 'CryptoPanic',
          publishedAt: new Date(article.created_at),
          votes: article.votes || {},
          type: 'news_aggregator',
          kind: article.kind
        }));
    }
  } catch (error) {
    console.log('Error fetching CryptoPanic news:', error.response?.data?.message || error.message);
  }
  return [];
}

// Parse RSS feed
async function parseRSSFeed(feedUrl, feedName) {
  try {
    const response = await axios.get(feedUrl, {
      timeout: 5000,
      headers: { 
        'User-Agent': 'rCryptoBot/1.0',
        'Accept': 'application/rss+xml, application/xml, text/xml'
      }
    });

    const $ = cheerio.load(response.data, { xmlMode: true });
    const items = [];

    $('item').each((index, element) => {
      if (index < 10) { // Limit to 10 items per feed
        const title = $(element).find('title').text();
        const link = $(element).find('link').text();
        const description = $(element).find('description').text();
        const pubDate = $(element).find('pubDate').text();

        items.push({
          title: title,
          content: description.replace(/<[^>]*>/g, '').substring(0, 500),
          url: link,
          source: feedName,
          publishedAt: pubDate ? new Date(pubDate) : new Date(),
          type: 'rss_feed'
        });
      }
    });

    return items;
  } catch (error) {
    console.log(`Error parsing RSS feed from ${feedName}:`, error.message);
    return [];
  }
}

// Get news from all RSS feeds
async function getRSSNews(symbol, symbolContext) {
  try {
    const context = symbolContext || await getSymbolContext(symbol);
    const allFeedItems = await Promise.all(
      NEWS_SOURCES.RSS_FEEDS.map(feed => parseRSSFeed(feed.url, feed.name))
    );

    const combinedItems = allFeedItems.flat();
    
    // Filter for symbol relevance
    const relevantItems = combinedItems.filter(item => {
      return matchesSymbolText(item.title, context) ||
             matchesSymbolText(item.content, context);
    });

    // Sort by date and return top 8
    return relevantItems
      .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
      .slice(0, 8);

  } catch (error) {
    console.log('Error fetching RSS news:', error.message);
    return [];
  }
}

// Get Google News for crypto
async function getGoogleNews(symbol, symbolContext) {
  try {
    const context = symbolContext || await getSymbolContext(symbol);
    // Google News RSS feed for crypto queries
    const queryTerms = new Set();
    queryTerms.add(context.primarySearchTerm);
    queryTerms.add(context.symbol);
    queryTerms.add('cryptocurrency');
    const query = encodeURIComponent(Array.from(queryTerms).filter(Boolean).join(' '));
    const rssUrl = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;
    
    const response = await axios.get(rssUrl, {
      timeout: 5000,
      headers: { 
        'User-Agent': 'rCryptoBot/1.0',
        'Accept': 'application/rss+xml, application/xml, text/xml'
      }
    });

    const $ = cheerio.load(response.data, { xmlMode: true });
    const items = [];

    $('item').each((index, element) => {
      if (index < 5) {
        const title = $(element).find('title').text();
        const link = $(element).find('link').text();
        const pubDate = $(element).find('pubDate').text();
        const source = $(element).find('source').text();

        items.push({
          title: title,
          content: title, // Google News RSS doesn't provide full content
          url: link,
          source: source || 'Google News',
          publishedAt: pubDate ? new Date(pubDate) : new Date(),
          type: 'google_news'
        });
      }
    });

    return items.filter(item => matchesSymbolText(item.title, context)).slice(0, 8);
  } catch (error) {
    console.log('Error fetching Google News:', error.message);
    return [];
  }
}

// Get X (Twitter) news - optimized single search to avoid rate limits
async function getTwitterNews(symbol, symbolContext) {
  try {
    // Check if X API credentials are configured
    if (!config.TWITTER_BEARER_TOKEN) {
      return [];
    }

    const context = symbolContext || await getSymbolContext(symbol);

    // Whale and flow monitoring accounts
    const whaleAccounts = [
      'whale_alert',
      'lookonchain', 
      'spotonchain',
      'arkhamIntel',
      'EmberCN',
      'ai_9684xtpa',
      'TheDataNerd_'
    ];

    const allTweets = [];

    // Single combined search: Prioritize whale accounts with flow keywords
    const keywordQuery = context.twitterKeywords.length > 0
      ? context.twitterKeywords.map(term => `"${term}"`).join(' OR ')
      : symbol;
    const authorQuery = whaleAccounts.map(account => `from:${account}`).join(' OR ');
    const combinedQuery = `(${keywordQuery}) (${authorQuery}) -is:retweet lang:en`;
    
    try {
      const response = await axios.get('https://api.twitter.com/2/tweets/search/recent', {
        params: {
          query: combinedQuery,
          max_results: 50, // Get more from whale accounts
          'tweet.fields': 'created_at,public_metrics,author_id',
          'user.fields': 'name,username,verified',
          expansions: 'author_id'
        },
        headers: {
          'Authorization': `Bearer ${config.TWITTER_BEARER_TOKEN}`
        },
        timeout: 8000
      });

      if (response.data && response.data.data) {
        const users = {};
        if (response.data.includes?.users) {
          response.data.includes.users.forEach(user => {
            users[user.id] = user;
          });
        }

        response.data.data.forEach(tweet => {
          const author = users[tweet.author_id] || {};
          const isWhaleAccount = whaleAccounts.includes(author.username);
          const matchesQuery = matchesSymbolText(tweet.text, context) || matchesSymbolText(author.username, context);
          if (!matchesQuery) {
            return;
          }
          
          allTweets.push({
            title: `${isWhaleAccount ? '🐋 ' : ''}@${author.username}: ${tweet.text.substring(0, 100)}...`,
            content: tweet.text,
            url: `https://x.com/${author.username}/status/${tweet.id}`,
            source: `X (${isWhaleAccount ? '🐋 ' : ''}@${author.username})`,
            publishedAt: new Date(tweet.created_at),
            type: isWhaleAccount ? 'twitter_whale' : 'twitter_flow',
            metrics: tweet.public_metrics,
            isWhaleAccount: isWhaleAccount,
            priority: isWhaleAccount ? 100 : 50
          });
        });
      }
    } catch (error) {
      if (error.response?.status === 429) {
        console.log('X API rate limit reached - skipping X data for this query');
      } else {
        console.log('Error fetching X posts:', error.message);
      }
    }

    // Remove duplicates and sort by priority and engagement
    const uniqueTweets = removeDuplicateTweets(allTweets);
    return uniqueTweets
      .sort((a, b) => {
        // Prioritize whale accounts
        if (a.priority !== b.priority) return b.priority - a.priority;
        // Then by engagement
        const engagementA = (a.metrics?.like_count || 0) + (a.metrics?.retweet_count || 0) * 2;
        const engagementB = (b.metrics?.like_count || 0) + (b.metrics?.retweet_count || 0) * 2;
        return engagementB - engagementA;
      })
      .slice(0, 8); // Return top 8 posts

  } catch (error) {
    console.log('Error fetching X news:', error.message);
  }
  return [];
}

// Remove duplicate tweets by ID
function removeDuplicateTweets(tweets) {
  const seenIds = new Set();
  return tweets.filter(tweet => {
    const tweetId = tweet.url.split('/').pop();
    if (seenIds.has(tweetId)) {
      return false;
    }
    seenIds.add(tweetId);
    return true;
  });
}

// Calculate quality score for general news
function calculateNewsQualityScore(newsItem) {
  let score = 50; // Base score

  // Recency bonus (within last 24 hours)
  const ageHours = (Date.now() - new Date(newsItem.publishedAt).getTime()) / (1000 * 60 * 60);
  if (ageHours < 24) score += 30;
  else if (ageHours < 48) score += 15;
  else if (ageHours < 72) score += 5;

  // Source reputation
  const premiumSources = ['CoinDesk', 'CoinTelegraph', 'Decrypt', 'Bloomberg', 'Reuters'];
  if (premiumSources.some(s => newsItem.source.includes(s))) {
    score += 25;
  }

  // Content quality
  if (newsItem.content && newsItem.content.length > 200) score += 15;
  if (newsItem.content && newsItem.content.length > 400) score += 10;

  // Title quality
  if (newsItem.title && newsItem.title.length > 40) score += 5;

  // Engagement metrics (for Twitter)
  if (newsItem.type === 'twitter' && newsItem.metrics) {
    const engagement = (newsItem.metrics.like_count || 0) + (newsItem.metrics.retweet_count || 0) * 2;
    score += Math.min(engagement / 10, 30);
  }

  // Votes (for CryptoPanic)
  if (newsItem.votes) {
    const totalVotes = (newsItem.votes.positive || 0) + (newsItem.votes.negative || 0);
    if (totalVotes > 10) score += 15;
  }

  return score;
}

// Aggregate all news sources
async function aggregateQualityNews(symbol, getCachedCryptoData) {
  let symbolContext;
  try {
    console.log(`Aggregating high-quality news from multiple sources for ${symbol}...`);
    symbolContext = await getSymbolContext(symbol);

    // Fetch from all sources in parallel
    const [
      qualityReddit, 
      cryptoCompareNews,
      cryptoPanicNews,
      rssNews,
      googleNews,
      twitterNews,
      orderBookData,
      unusualActivity
    ] = await Promise.all([
      getQualityRedditNews(symbol, symbolContext),
      getCryptoCompareNews(symbol, symbolContext),
      getCryptoPanicNews(symbol, symbolContext),
      getRSSNews(symbol, symbolContext),
      getGoogleNews(symbol, symbolContext),
      getTwitterNews(symbol, symbolContext),
      orderBookSentiment.analyzeOrderBook(symbol),
      activityDetector.detectUnusualActivity(symbol, getCachedCryptoData)
    ]);

    // Combine all general news sources
    const allGeneralNews = [
      ...cryptoCompareNews,
      ...cryptoPanicNews,
      ...rssNews,
      ...googleNews
    ];

    // Sort by quality score and remove duplicates
    const uniqueNews = removeDuplicateNews(allGeneralNews);
    const sortedGeneralNews = uniqueNews
      .map(item => ({
        ...item,
        qualityScore: calculateNewsQualityScore(item)
      }))
      .sort((a, b) => b.qualityScore - a.qualityScore)
      .slice(0, 10); // Top 10 general news items

    const totalSources = qualityReddit.length + sortedGeneralNews.length + twitterNews.length;

    return {
      reddit: qualityReddit,
      general: sortedGeneralNews,
      twitter: twitterNews,
      unusualActivity: unusualActivity,
      orderBookSentiment: orderBookData,
      timestamp: new Date(),
      totalQualitySources: totalSources,
      dataQuality: totalSources > 5 ? 'premium' : totalSources > 2 ? 'good' : 'limited',
      activityDetected: unusualActivity.length > 0,
      symbolContext,
      sourceBreakdown: {
        reddit: qualityReddit.length,
        cryptoCompare: cryptoCompareNews.length,
        cryptoPanic: cryptoPanicNews.length,
        rss: rssNews.length,
        google: googleNews.length,
        twitter: twitterNews.length
      }
    };
  } catch (error) {
    console.error('Error aggregating quality news:', error.message);
    return {
      reddit: [],
      general: [],
      twitter: [],
      unusualActivity: [],
      orderBookSentiment: null,
      timestamp: new Date(),
      totalQualitySources: 0,
      dataQuality: 'limited',
      activityDetected: false,
      symbolContext,
      error: 'Failed to fetch some premium news sources'
    };
  }
}

// Remove duplicate news based on title similarity
function removeDuplicateNews(newsItems) {
  const uniqueItems = [];
  const seenTitles = new Set();

  for (const item of newsItems) {
    // Normalize title for comparison
    const normalizedTitle = item.title?.toLowerCase().trim().substring(0, 50) || '';
    
    // Check if we've seen a very similar title
    let isDuplicate = false;
    for (const seenTitle of seenTitles) {
      if (normalizedTitle && seenTitle && 
          (normalizedTitle.includes(seenTitle) || seenTitle.includes(normalizedTitle))) {
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate && normalizedTitle) {
      uniqueItems.push(item);
      seenTitles.add(normalizedTitle);
    }
  }

  return uniqueItems;
}

// Get AI-powered comprehensive briefing
async function getComprehensiveBriefing(newsData, symbol) {
  try {
    const symbolContext = newsData.symbolContext || await getSymbolContext(symbol);
    const assetName = symbolContext?.name || symbol;
    const displayLabel = assetName && assetName.toUpperCase() !== symbol ? `${assetName} (${symbol})` : symbol;
    const contextIdentifiers = [symbol, assetName, symbolContext?.coinId].filter(Boolean).map(value => value.toString()).join(', ');
    const contentSections = [];
    
    // Add general news from multiple sources
    if (newsData.general && newsData.general.length > 0) {
      contentSections.push("=== CRYPTO NEWS FROM MAJOR SOURCES ===");
      newsData.general.slice(0, 6).forEach((item, index) => {
        contentSections.push(`\nNews ${index + 1} (Source: ${item.source}):`);
        contentSections.push(`Title: ${item.title}`);
        if (item.content && item.content.length > 50) {
          contentSections.push(`Content: ${item.content.substring(0, 400)}`);
        }
        contentSections.push(`URL: ${item.url}`);
        const ageHours = Math.round((Date.now() - new Date(item.publishedAt).getTime()) / (1000 * 60 * 60));
        contentSections.push(`Published: ${ageHours} hours ago`);
      });
    }

    // Add X (Twitter) insights - Whale accounts first
    if (newsData.twitter && newsData.twitter.length > 0) {
      const whaleTwitter = newsData.twitter.filter(t => t.isWhaleAccount);
      const generalTwitter = newsData.twitter.filter(t => !t.isWhaleAccount);
      
      if (whaleTwitter.length > 0) {
        contentSections.push("\n\n=== 🐋 WHALE ACTIVITY ALERTS (X) ===");
        whaleTwitter.slice(0, 5).forEach((item, index) => {
          const ageHours = Math.round((Date.now() - new Date(item.publishedAt).getTime()) / (1000 * 60 * 60));
          contentSections.push(`\nWhale Alert ${index + 1} (${ageHours}h ago):`);
          contentSections.push(`${item.content}`);
          contentSections.push(`From: ${item.source}`);
          if (item.metrics) {
            contentSections.push(`Engagement: ${item.metrics.like_count} likes, ${item.metrics.retweet_count} retweets`);
          }
        });
      }
      
      if (generalTwitter.length > 0) {
        contentSections.push("\n\n=== X FLOW & ACTIVITY ===");
        generalTwitter.slice(0, 3).forEach((item, index) => {
          const ageHours = Math.round((Date.now() - new Date(item.publishedAt).getTime()) / (1000 * 60 * 60));
          contentSections.push(`\nFlow Post ${index + 1} (${ageHours}h ago):`);
          contentSections.push(`${item.content}`);
          contentSections.push(`From: ${item.source}`);
        });
      }
    }
    
    // Add Reddit discussions
    if (newsData.reddit && newsData.reddit.length > 0) {
      contentSections.push("\n\n=== REDDIT COMMUNITY DISCUSSIONS ===");
      newsData.reddit.slice(0, 4).forEach((item, index) => {
        contentSections.push(`\nDiscussion ${index + 1} (${item.score || 0} upvotes, ${item.comments || 0} comments):`);
        contentSections.push(`Title: ${item.title}`);
        if (item.content && item.content.length > 50) {
          contentSections.push(`Content: ${item.content.substring(0, 300)}`);
        }
        contentSections.push(`Source: ${item.source}`);
      });
    }

    // Add unusual activity
    if (newsData.unusualActivity && newsData.unusualActivity.length > 0) {
      contentSections.push("\n\n=== UNUSUAL MARKET ACTIVITY DETECTED ===");
      newsData.unusualActivity.forEach((activity, index) => {
        contentSections.push(`\nActivity ${index + 1} (${activity.severity} severity, ${activity.impact} impact):`);
        contentSections.push(`Type: ${activity.type.replace('_', ' ').toUpperCase()}`);
        contentSections.push(`Description: ${activity.description}`);
      });
    }
    
    if (newsData.orderBookSentiment) {
      const depth = newsData.orderBookSentiment;
      contentSections.push("\n\n=== ORDER BOOK LIQUIDITY SNAPSHOT ===");
      contentSections.push(`Exchange: ${depth.exchange} | Pair: ${depth.pair}`);
      contentSections.push(`Sentiment: ${depth.sentiment} | Imbalance: ${(depth.imbalance * 100).toFixed(2)}%`);
      contentSections.push(`Bid Liquidity: $${formatLiquidityNumber(depth.bidVolumeUsd)} | Ask Liquidity: $${formatLiquidityNumber(depth.askVolumeUsd)}`);
      if (depth.spreadPercent !== null && depth.spreadPercent !== undefined) {
        contentSections.push(`Spread: ${(depth.spreadPercent * 100).toFixed(3)}%`);
      }
      contentSections.push(`Top Bid: ${formatOrderBookPrice(depth.topBid.price)} (${formatOrderBookQuantity(depth.topBid.quantity)})`);
      contentSections.push(`Top Ask: ${formatOrderBookPrice(depth.topAsk.price)} (${formatOrderBookQuantity(depth.topAsk.quantity)})`);
    }
    
    if (contentSections.length === 0) {
      return {
        briefing: `No recent news or discussions found for ${displayLabel}.`,
        totalSources: 0,
        analysis: {
          marketActivity: 'Low',
          newsVolume: 'Minimal',
          communityEngagement: 'Limited'
        }
      };
    }
    
    const fullContent = contentSections.join('\n');
    
    const prompt = `You are a senior cryptocurrency market analyst. Analyze the following data SPECIFICALLY about ${displayLabel} cryptocurrency.
Identifiers to keep in mind: ${contextIdentifiers}.

${fullContent}

CRITICAL: Focus ONLY on information directly related to ${displayLabel}. Ignore any mentions of other cryptocurrencies unless they directly impact ${displayLabel}.

Provide a CONCISE briefing in this format:

EXECUTIVE SUMMARY:
[2-3 sentences about ${displayLabel} ONLY - key price movements, major developments, whale activity]

KEY DEVELOPMENTS:
• [${displayLabel}-specific development 1]
• [${displayLabel}-specific development 2]
• [${displayLabel}-specific development 3]
• [${displayLabel}-specific development 4]

MARKET ACTIVITY:
[Describe ${displayLabel}'s unusual activity, exchange flows, whale movements if detected]

COMMUNITY INSIGHTS:
[What sophisticated investors are saying specifically about ${displayLabel}]

OUTLOOK:
[Professional assessment for ${displayLabel} - key levels to watch, potential catalysts]

Keep it under 1500 characters total. DO NOT mention other cryptocurrencies unless they directly affect ${displayLabel}.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "You are a senior cryptocurrency market analyst. Provide professional, structured analysis reports."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      max_tokens: 1200,
      temperature: 0.2
    });

    const briefingText = completion.choices[0].message.content;
    
    const analysis = {
      marketActivity: determineMarketActivity(newsData),
      newsVolume: newsData.general?.length > 2 ? 'High' : newsData.general?.length > 0 ? 'Medium' : 'Low',
      communityEngagement: determineCommunityEngagement(newsData.reddit),
      orderBookSentiment: newsData.orderBookSentiment?.sentiment || 'Unknown'
    };

    return {
      briefing: briefingText,
      totalSources: (newsData.reddit?.length || 0) + (newsData.general?.length || 0),
      analysis: analysis,
      aiGenerated: true,
      modelUsed: 'GPT-3.5-Turbo'
    };

  } catch (error) {
    console.error('Error getting comprehensive briefing:', error.message);
    
    const totalSources = (newsData.reddit?.length || 0) + (newsData.general?.length || 0);
    let fallbackBriefing = `**BRIEFING FOR ${symbol}**\n\n`;
    
    if (totalSources === 0) {
      fallbackBriefing += `**EXECUTIVE SUMMARY:**\nNo recent news or community discussions found for ${symbol}.`;
    } else {
      fallbackBriefing += `**EXECUTIVE SUMMARY:**\nFound ${totalSources} recent sources discussing ${symbol}.\n\n`;
      
      if (newsData.reddit && newsData.reddit.length > 0) {
        const topPost = newsData.reddit.sort((a, b) => (b.score || 0) - (a.score || 0))[0];
        fallbackBriefing += `**KEY DISCUSSION:**\n"${topPost.title}" (${topPost.score || 0} upvotes)\n\n`;
      }
      
      fallbackBriefing += `**NOTE:** AI analysis temporarily unavailable.`;
    }
    
    if (newsData.orderBookSentiment) {
      const depth = newsData.orderBookSentiment;
      const imbalancePercent = Number.isFinite(depth.imbalance) ? (depth.imbalance * 100).toFixed(1) : '0.0';
      fallbackBriefing += `\n\n**ORDER BOOK SENTIMENT:** ${depth.sentiment} (${imbalancePercent}% imbalance, ${depth.exchange} ${depth.pair})`;
    }
    
    return {
      briefing: fallbackBriefing,
      totalSources: totalSources,
      analysis: {
        marketActivity: 'Unknown',
        newsVolume: 'Limited',
        communityEngagement: 'Unknown',
        orderBookSentiment: newsData.orderBookSentiment?.sentiment || 'Unknown'
      },
      error: 'AI analysis unavailable'
    };
  }
}

// Generate professional briefing
function generateProfessionalBriefing(newsData, comprehensiveBriefing, symbol) {
  let output = `📊 ${symbol} PREMIUM BRIEFING\n\n`;

  output += `⭐ PREMIUM DATA QUALITY DASHBOARD\n`;
  output += `• Data Quality: ${newsData.dataQuality || 'Premium'}\n`;
  output += `• Market Activity: ${comprehensiveBriefing.analysis.marketActivity}\n`;
  output += `• News Volume: ${comprehensiveBriefing.analysis.newsVolume}\n`;
  output += `• Community Engagement: ${comprehensiveBriefing.analysis.communityEngagement}\n`;
  if (newsData.orderBookSentiment) {
    const depth = newsData.orderBookSentiment;
    const imbalancePercent = Number.isFinite(depth.imbalance) ? (depth.imbalance * 100).toFixed(1) : '0.0';
    output += `• Order Book: ${depth.sentiment} (${imbalancePercent}% imbalance, ${depth.exchange} ${depth.pair})\n`;
  } else {
    output += `• Order Book: ${comprehensiveBriefing.analysis.orderBookSentiment || 'Unknown'}\n`;
  }
  output += `• Premium Sources: ${newsData.totalQualitySources || comprehensiveBriefing.totalSources}\n\n`;

  const briefingText = comprehensiveBriefing.briefing || '';
  if (briefingText.length > 2000) {
    output += briefingText.substring(0, 2000) + '...\n\n*[Briefing truncated]*\n\n';
  } else {
    output += `${briefingText}\n\n`;
  }

  if (newsData.unusualActivity && newsData.unusualActivity.length > 0) {
    output += `🚨 UNUSUAL MARKET ACTIVITY ALERT\n`;
    
    const buyActivities = newsData.unusualActivity.filter(a => a.type === 'large_buys_24h');
    const sellActivities = newsData.unusualActivity.filter(a => a.type === 'large_sells_24h');
    const flowActivities = newsData.unusualActivity.filter(a => 
      ['exchange_flow_detailed', 'net_flow_24h', 'estimated_flow_24h'].includes(a.type)
    );
    const otherActivities = newsData.unusualActivity.filter(a => 
      !['large_buys_24h', 'large_sells_24h', 'exchange_flow_detailed', 'net_flow_24h', 'estimated_flow_24h'].includes(a.type)
    );

    if (buyActivities.length > 0) {
      buyActivities.forEach((activity) => {
        const severityEmoji = activity.severity === 'high' ? '🔴' : '🟡';
        output += `${severityEmoji}📈 LARGE BUYS DETECTED:\n${activity.description}\n\n`;
      });
    }

    if (sellActivities.length > 0) {
      sellActivities.forEach((activity) => {
        const severityEmoji = activity.severity === 'high' ? '🔴' : '🟡';
        output += `${severityEmoji}📉 LARGE SELLS DETECTED:\n${activity.description}\n\n`;
      });
    }

    if (flowActivities.length > 0) {
      flowActivities.forEach((activity) => {
        const severityEmoji = activity.severity === 'high' ? '🔴' : '🟡';
        const impactEmoji = activity.impact === 'High' ? '⚡' : '📊';
        
        if (activity.type === 'exchange_flow_detailed') {
          output += `${severityEmoji}${impactEmoji} EXCHANGE FLOW DETAILED:\n${activity.description}\n\n`;
        } else if (activity.type === 'net_flow_24h') {
          output += `${severityEmoji}${impactEmoji} 24H NET FLOW:\n${activity.description}\n\n`;
        } else if (activity.type === 'estimated_flow_24h') {
          output += `${severityEmoji}${impactEmoji} 24H PRESSURE ANALYSIS:\n${activity.description}\n\n`;
        }
      });
    }

    if (otherActivities.length > 0) {
      const topOtherActivities = otherActivities.slice(0, 3);
      topOtherActivities.forEach((activity) => {
        const severityEmoji = activity.severity === 'high' ? '🔴' :
                             activity.severity === 'medium' ? '🟡' : '🟢';
        const impactEmoji = activity.impact === 'Very High' ? '⚠️' :
                           activity.impact === 'High' ? '⚡' :
                           activity.impact === 'Medium' ? '📊' : 'ℹ️';

        const cleanDescription = (activity.description || '').replace(/[*_`[\]()]/g, '').substring(0, 250);
        const cleanType = (activity.type || 'unknown').replace(/_/g, ' ').toUpperCase();
        output += `${severityEmoji}${impactEmoji} ${cleanType}:\n${cleanDescription}\n\n`;
      });
    }
  }

  if (newsData.orderBookSentiment) {
    const depth = newsData.orderBookSentiment;
    const imbalancePercent = Number.isFinite(depth.imbalance) ? (depth.imbalance * 100).toFixed(1) : '0.0';
    const bidShare = Number.isFinite(depth.bidSharePercent) ? depth.bidSharePercent.toFixed(1) : '0.0';
    const askShare = Number.isFinite(depth.askSharePercent) ? depth.askSharePercent.toFixed(1) : '0.0';
    const spread = Number.isFinite(depth.spreadPercent) ? (depth.spreadPercent * 100).toFixed(3) : 'N/A';
    output += `📊 ORDER BOOK LIQUIDITY\n`;
    output += `• ${depth.exchange} ${depth.pair} → ${depth.sentiment} (${imbalancePercent}% imbalance)\n`;
    output += `• Bid Liquidity $${formatLiquidityNumber(depth.bidVolumeUsd)} (${bidShare}% depth) | Ask $${formatLiquidityNumber(depth.askVolumeUsd)} (${askShare}% depth)\n`;
    output += `• Spread ${spread}% | Top Bid ${formatOrderBookPrice(depth.topBid.price)} (${formatOrderBookQuantity(depth.topBid.quantity)}) vs Top Ask ${formatOrderBookPrice(depth.topAsk.price)} (${formatOrderBookQuantity(depth.topAsk.quantity)})\n\n`;
  }

  // Add whale activity from X if present
  if (newsData.twitter && newsData.twitter.length > 0) {
    const whaleTwitter = newsData.twitter.filter(t => t.isWhaleAccount);
    
    if (whaleTwitter.length > 0) {
      output += `🐋 WHALE ACTIVITY FROM X\n`;
      
      whaleTwitter.slice(0, 3).forEach((tweet, index) => {
        const timeAgo = getTimeAgo(new Date(tweet.publishedAt));
        const cleanContent = cleanTweetContent(tweet.content);
        
        output += `\n${index + 1}. ${tweet.source} • ${timeAgo}\n`;
        output += `${cleanContent}\n`;
        if (tweet.metrics) {
          output += `❤️ ${tweet.metrics.like_count || 0} | 🔄 ${tweet.metrics.retweet_count || 0} | 🔗 ${tweet.url}\n`;
        } else {
          output += `🔗 ${tweet.url}\n`;
        }
      });
      output += `\n`;
    }
  }

  output += `📊 DATA SOURCES\n`;
  const whaleCount = newsData.twitter?.filter(t => t.isWhaleAccount).length || 0;
  const flowCount = newsData.twitter?.filter(t => !t.isWhaleAccount).length || 0;
  output += `• Reddit: ${newsData.reddit?.length || 0} | News: ${newsData.general?.length || 0} | X: ${newsData.twitter?.length || 0} (🐋 ${whaleCount})\n`;
  if (newsData.sourceBreakdown) {
    const breakdown = newsData.sourceBreakdown;
    output += `• CryptoCompare: ${breakdown.cryptoCompare || 0} | CryptoPanic: ${breakdown.cryptoPanic || 0} | RSS: ${breakdown.rss || 0} | Google: ${breakdown.google || 0}\n`;
  }
  if (newsData.orderBookSentiment) {
    output += `• Order Book Source: ${newsData.orderBookSentiment.exchange} ${newsData.orderBookSentiment.pair}\n`;
  } else {
    output += `• Order Book Source: N/A\n`;
  }
  output += `• Activity Alerts: ${newsData.activityDetected ? '🟢 Detected' : '⚪ None'}\n\n`;

  if (comprehensiveBriefing.aiGenerated) {
    output += `🤖 AI Analysis | ⏰ ${new Date().toLocaleString()}\n`;
  }

  output += `💰 /price ${symbol} | 🔄 /news ${symbol}`;

  if (output.length > 4000) {
    output = output.substring(0, 3950) + '\n\n*[Message truncated]*';
  }

  return output;
}

function determineMarketActivity(newsData) {
  const totalActivity = (newsData.reddit?.length || 0) + (newsData.general?.length || 0);
  if (totalActivity >= 5) return 'High';
  if (totalActivity >= 2) return 'Medium';
  return 'Low';
}

function determineCommunityEngagement(redditData) {
  if (!redditData || redditData.length === 0) return 'Low';
  
  const avgScore = redditData.reduce((sum, post) => sum + (post.score || 0), 0) / redditData.length;
  const totalComments = redditData.reduce((sum, post) => sum + (post.comments || 0), 0);
  
  if (avgScore > 50 && totalComments > 100) return 'Very High';
  if (avgScore > 20 && totalComments > 50) return 'High';
  if (avgScore > 5 && totalComments > 10) return 'Medium';
  return 'Low';
}

// Helper function to format time ago
function getTimeAgo(date) {
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

// Helper function to clean tweet content for display
function cleanTweetContent(content) {
  if (!content) return '';
  
  let cleaned = content;
  
  // Remove URLs (https://t.co/... and other URLs)
  cleaned = cleaned.replace(/https?:\/\/\S+/g, '');
  
  // Remove excessive repeated emojis (keep only one)
  // Match any emoji repeated 3+ times and replace with single instance
  cleaned = cleaned.replace(/([\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}])\s*\1{2,}/gu, '$1');
  
  // Clean up hashtags - remove # but keep the text
  cleaned = cleaned.replace(/#(\w+)/g, '$1');
  
  // Remove excessive whitespace and newlines
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  
  // Limit length to 280 characters
  if (cleaned.length > 280) {
    cleaned = cleaned.substring(0, 277) + '...';
  }
  
  return cleaned;
}

module.exports = {
  getQualityRedditNews,
  aggregateQualityNews,
  getComprehensiveBriefing,
  generateProfessionalBriefing
};

