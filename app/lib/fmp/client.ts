/**
 * FMP API Client with Rate Limiting
 *
 * Handles all requests to Financial Modeling Prep API with:
 * - Configurable rate limiting (default 750 calls/min)
 * - Automatic retry with exponential backoff
 * - Request queuing for burst protection
 */

import { sleep, retryWithBackoff } from './utils';

// ============================================================================
// Configuration
// ============================================================================

// FMP has migrated to a new "stable" API endpoint as of Aug 2025
// Old: https://financialmodelingprep.com/api/v3/...
// New: https://financialmodelingprep.com/stable/...
const FMP_BASE_URL = process.env.FMP_BASE_URL || 'https://financialmodelingprep.com/stable';
const FMP_API_KEY = process.env.FMP_API_KEY;

export interface FMPClientConfig {
  apiKey?: string;
  baseUrl?: string;
  callsPerMinute?: number;  // Rate limit (default: 750)
  maxRetries?: number;
  retryDelay?: number;
  timeout?: number;
}

const DEFAULT_CONFIG: Required<FMPClientConfig> = {
  apiKey: FMP_API_KEY || '',
  baseUrl: FMP_BASE_URL,
  // The plan sustains well above the old 750/min default (measured ~7.5k/min at
  // concurrency 10 with zero throttling). Keep headroom below that ceiling so the
  // per-minute window cap never trips the 60s circuit-breaker pause during a run.
  callsPerMinute: Number(process.env.FMP_CALLS_PER_MINUTE) || 6000,
  maxRetries: 3,
  retryDelay: 1000,
  timeout: 30000,
};

// ============================================================================
// Error Types
// ============================================================================

export class FMPError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public endpoint?: string,
    public originalError?: Error
  ) {
    super(message);
    this.name = 'FMPError';
  }
}

export class FMPRateLimitError extends FMPError {
  constructor(endpoint: string) {
    super(`Rate limit exceeded for ${endpoint}`, 429, endpoint);
    this.name = 'FMPRateLimitError';
  }
}

export class FMPNetworkError extends FMPError {
  constructor(endpoint: string, originalError?: Error) {
    super(`Network error for ${endpoint}`, undefined, endpoint, originalError);
    this.name = 'FMPNetworkError';
  }
}

export class FMPValidationError extends FMPError {
  constructor(message: string, endpoint?: string) {
    super(message, 400, endpoint);
    this.name = 'FMPValidationError';
  }
}

// ============================================================================
// FMP Client Class
// ============================================================================

export class FMPClient {
  private config: Required<FMPClientConfig>;
  private lastRequestTime: number = 0;
  private requestCount: number = 0;
  private windowStart: number = Date.now();
  private consecutive429s: number = 0;
  private rateLimitPausedUntil: number = 0;

  constructor(config: FMPClientConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    if (!this.config.apiKey) {
      console.warn('[FMP] Warning: No API key provided. Set FMP_API_KEY environment variable.');
    }
  }

  /**
   * Calculate minimum delay between requests based on rate limit
   */
  private get minDelayMs(): number {
    // 750 calls/min = 80ms between calls
    return Math.ceil(60000 / this.config.callsPerMinute);
  }

  /**
   * Enforce rate limiting before making a request
   */
  private async enforceRateLimit(): Promise<void> {
    // Circuit breaker: pause all requests after 5 consecutive 429s
    if (Date.now() < this.rateLimitPausedUntil) {
      const waitTime = this.rateLimitPausedUntil - Date.now();
      console.log(`[FMP] Circuit breaker active, pausing ${Math.round(waitTime / 1000)}s...`);
      await sleep(waitTime);
      this.consecutive429s = 0;
    }

    const now = Date.now();

    // Reset counter if we're in a new minute window
    if (now - this.windowStart > 60000) {
      this.windowStart = now;
      this.requestCount = 0;
    }

    // If we've hit the rate limit, wait for the window to reset
    if (this.requestCount >= this.config.callsPerMinute) {
      const waitTime = 60000 - (now - this.windowStart) + 100; // +100ms buffer
      console.log(`[FMP] Rate limit reached, waiting ${waitTime}ms...`);
      await sleep(waitTime);
      this.windowStart = Date.now();
      this.requestCount = 0;
    }

    // Enforce minimum delay between requests
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.minDelayMs) {
      await sleep(this.minDelayMs - timeSinceLastRequest);
    }

    this.lastRequestTime = Date.now();
    this.requestCount++;
  }

  /**
   * Build URL with API key
   * All endpoints now use the stable API base for Premium plan compatibility
   */
  private buildUrl(endpoint: string, params: Record<string, string | number | boolean> = {}): string {
    // Use stable base URL for all endpoints
    const baseUrl = this.config.baseUrl;

    const url = new URL(`${baseUrl}${endpoint}`);

    // Add query parameters
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }

    // Add API key
    url.searchParams.set('apikey', this.config.apiKey);

    return url.toString();
  }

  /**
   * Make a rate-limited API request
   */
  async fetch<T>(
    endpoint: string,
    params: Record<string, string | number | boolean> = {}
  ): Promise<T> {
    await this.enforceRateLimit();

    const url = this.buildUrl(endpoint, params);

    return retryWithBackoff(
      async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

        try {
          const response = await fetch(url, {
            method: 'GET',
            signal: controller.signal,
            headers: {
              'Accept': 'application/json',
            },
          });

          clearTimeout(timeoutId);

          if (response.status === 429 || response.status === 402) {
            // 429 = standard rate limit, 402 = FMP's "payment required" which also indicates rate limit exceeded
            this.consecutive429s++;
            if (this.consecutive429s >= 5) {
              this.rateLimitPausedUntil = Date.now() + 60000;
              console.log(`[FMP] Circuit breaker: ${this.consecutive429s} consecutive 429s. Pausing 60s.`);
            }
            throw new FMPRateLimitError(endpoint);
          }

          if (!response.ok) {
            throw new FMPError(
              `FMP API error: ${response.status} ${response.statusText}`,
              response.status,
              endpoint
            );
          }

          const data = await response.json();

          // FMP returns error messages in the response body sometimes
          if (data && typeof data === 'object' && 'Error Message' in data) {
            throw new FMPValidationError(data['Error Message'], endpoint);
          }

          this.consecutive429s = 0; // Reset on success
          return data as T;
        } catch (error) {
          clearTimeout(timeoutId);

          if (error instanceof FMPError) {
            throw error;
          }

          if (error instanceof Error && error.name === 'AbortError') {
            throw new FMPNetworkError(endpoint, new Error('Request timed out'));
          }

          throw new FMPNetworkError(endpoint, error as Error);
        }
      },
      {
        maxRetries: this.config.maxRetries,
        baseDelay: this.config.retryDelay,
        onRetry: (attempt, error) => {
          console.log(`[FMP] Retry ${attempt}/${this.config.maxRetries} for ${endpoint}: ${error.message}`);
        },
      }
    );
  }

  // ==========================================================================
  // Stock Lists
  // ==========================================================================

  /**
   * Get list of all tradable stocks
   * Stable API: /available-traded-list
   */
  async getTradableStocks(): Promise<FMPTradableStock[]> {
    return this.fetch<FMPTradableStock[]>('/available-traded-list');
  }

  /**
   * Get all stock symbols with basic info
   * Stable API: /stock-list
   */
  async getStockList(): Promise<FMPStockListItem[]> {
    return this.fetch<FMPStockListItem[]>('/stock-list');
  }

  // ==========================================================================
  // Company Profile
  // ==========================================================================

  /**
   * Get company profile for a single ticker
   * Uses stable API: /profile?symbol=TICKER
   */
  async getProfile(ticker: string): Promise<FMPProfile | null> {
    const data = await this.fetch<FMPProfile[]>(`/profile`, { symbol: ticker.toUpperCase() });
    return data?.[0] || null;
  }

  /**
   * Get company profiles for multiple tickers (batch)
   * Uses stable API: /profile?symbol=AAPL,MSFT,GOOGL
   */
  async getProfiles(tickers: string[]): Promise<FMPProfile[]> {
    if (tickers.length === 0) return [];
    const symbols = tickers.map(t => t.toUpperCase()).join(',');
    return this.fetch<FMPProfile[]>(`/profile`, { symbol: symbols });
  }

  // ==========================================================================
  // Stock Quotes
  // ==========================================================================

  /**
   * Get quote for a single ticker
   * Stable API: /quote?symbol=TICKER
   */
  async getQuote(ticker: string): Promise<FMPQuote | null> {
    const data = await this.fetch<FMPQuote[]>(`/quote`, { symbol: ticker.toUpperCase() });
    return data?.[0] || null;
  }

  /**
   * Get quotes for multiple tickers (batch, up to 1000)
   * Stable API: /batch-quote?symbols=AAPL,MSFT
   */
  async getQuotes(tickers: string[]): Promise<FMPQuote[]> {
    if (tickers.length === 0) return [];
    const symbols = tickers.map(t => t.toUpperCase()).join(',');
    return this.fetch<FMPQuote[]>(`/batch-quote`, { symbols });
  }

  // ==========================================================================
  // Key Metrics
  // ==========================================================================

  /**
   * Get TTM key metrics for a ticker
   * Stable API: /key-metrics-ttm?symbol=TICKER
   */
  async getKeyMetricsTTM(ticker: string): Promise<FMPKeyMetricsTTM | null> {
    const data = await this.fetch<FMPKeyMetricsTTM[]>(`/key-metrics-ttm`, { symbol: ticker.toUpperCase() });
    return data?.[0] || null;
  }

  /**
   * Get historical key metrics
   * Stable API: /key-metrics?symbol=TICKER&period=annual&limit=5
   */
  async getKeyMetrics(
    ticker: string,
    period: 'annual' | 'quarter' = 'annual',
    limit: number = 5
  ): Promise<FMPKeyMetrics[]> {
    return this.fetch<FMPKeyMetrics[]>(`/key-metrics`, {
      symbol: ticker.toUpperCase(),
      period,
      limit,
    });
  }

  // ==========================================================================
  // Financial Ratios
  // ==========================================================================

  /**
   * Get TTM financial ratios for a ticker
   * Stable API: /ratios-ttm?symbol=TICKER
   */
  async getRatiosTTM(ticker: string): Promise<FMPRatiosTTM | null> {
    const data = await this.fetch<FMPRatiosTTM[]>(`/ratios-ttm`, { symbol: ticker.toUpperCase() });
    return data?.[0] || null;
  }

  /**
   * Get historical financial ratios
   * Stable API: /ratios?symbol=TICKER&period=annual&limit=5
   */
  async getRatios(
    ticker: string,
    period: 'annual' | 'quarter' = 'annual',
    limit: number = 5
  ): Promise<FMPRatios[]> {
    return this.fetch<FMPRatios[]>(`/ratios`, {
      symbol: ticker.toUpperCase(),
      period,
      limit,
    });
  }

  // ==========================================================================
  // Financial Growth
  // ==========================================================================

  /**
   * Get financial growth metrics
   * Stable API: /financial-growth?symbol=TICKER&period=annual&limit=5
   */
  async getFinancialGrowth(
    ticker: string,
    period: 'annual' | 'quarter' = 'annual',
    limit: number = 5
  ): Promise<FMPFinancialGrowth[]> {
    return this.fetch<FMPFinancialGrowth[]>(`/financial-growth`, {
      symbol: ticker.toUpperCase(),
      period,
      limit,
    });
  }

  // ==========================================================================
  // Historical Prices
  // ==========================================================================

  /**
   * Get historical daily prices for a ticker
   * Uses the new stable API: /stable/historical-price-eod/full
   */
  async getHistoricalPrices(
    ticker: string,
    from?: string,
    to?: string
  ): Promise<FMPHistoricalPriceResponse> {
    const params: Record<string, string> = { symbol: ticker.toUpperCase() };
    if (from) params.from = from;
    if (to) params.to = to;

    // New stable API returns array directly, not wrapped in {symbol, historical}
    const data = await this.fetch<FMPHistoricalPriceStable[]>(
      `/historical-price-eod/full`,
      params
    );

    // Convert to legacy format for backward compatibility
    return {
      symbol: ticker.toUpperCase(),
      historical: data.map(item => ({
        date: item.date,
        open: item.open,
        high: item.high,
        low: item.low,
        close: item.close,
        adjClose: item.close, // Stable API doesn't provide adjClose, use close
        volume: item.volume,
        unadjustedVolume: item.volume,
        change: item.change,
        changePercent: item.changePercent,
        vwap: item.vwap,
        label: item.date,
        changeOverTime: item.changePercent / 100,
      })),
    };
  }

  /**
   * Get batch EOD prices for all stocks on a specific date
   */
  async getBatchEODPrices(date: string): Promise<FMPBatchEODPrice[]> {
    return this.fetch<FMPBatchEODPrice[]>('/batch-request-end-of-day-prices', { date });
  }

  // ==========================================================================
  // Technical Indicators
  // ==========================================================================

  /**
   * Get technical indicator data
   * Stable API: /technical-indicators/{type}?symbol=TICKER&timeframe=1day&periodLength=14
   */
  async getTechnicalIndicator(
    ticker: string,
    type: 'sma' | 'ema' | 'wma' | 'rsi' | 'adx' | 'standardDeviation' | 'williams',
    period: number = 14
  ): Promise<FMPTechnicalIndicator[]> {
    return this.fetch<FMPTechnicalIndicator[]>(
      `/technical-indicators/${type}`,
      { symbol: ticker.toUpperCase(), timeframe: '1day', periodLength: period }
    );
  }

  // ==========================================================================
  // Analyst Data
  // ==========================================================================

  /**
   * Get price target consensus
   * Stable API: /price-target-consensus?symbol=TICKER
   */
  async getPriceTargetConsensus(ticker: string): Promise<FMPPriceTargetConsensus | null> {
    const data = await this.fetch<FMPPriceTargetConsensus[]>(
      '/price-target-consensus',
      { symbol: ticker.toUpperCase() }
    );
    return data?.[0] || null;
  }

  /**
   * Get analyst estimates
   * Stable API: /analyst-estimates?symbol=TICKER&period=annual&limit=5
   */
  async getAnalystEstimates(
    ticker: string,
    period: 'annual' | 'quarter' = 'annual',
    limit: number = 5
  ): Promise<FMPAnalystEstimate[]> {
    return this.fetch<FMPAnalystEstimate[]>(`/analyst-estimates`, {
      symbol: ticker.toUpperCase(),
      period,
      limit,
    });
  }

  // ==========================================================================
  // DCF Valuation
  // ==========================================================================

  /**
   * Get DCF (Discounted Cash Flow) valuation for a ticker
   * Returns the calculated fair value per share based on DCF analysis
   * Stable API: /discounted-cash-flow?symbol=TICKER
   */
  async getDCF(ticker: string): Promise<FMPDCFData | null> {
    const data = await this.fetch<FMPDCFData[]>(`/discounted-cash-flow`, { symbol: ticker.toUpperCase() });
    return data?.[0] || null;
  }

  /**
   * Get historical DCF valuations for a ticker
   * Stable API: /historical-discounted-cash-flow-statement?symbol=TICKER
   */
  async getHistoricalDCF(ticker: string): Promise<FMPHistoricalDCF[]> {
    return this.fetch<FMPHistoricalDCF[]>(`/historical-discounted-cash-flow-statement`, { symbol: ticker.toUpperCase() });
  }

  // ==========================================================================
  // Income Statement
  // ==========================================================================

  /**
   * Get income statement
   * Stable API: /income-statement?symbol=TICKER&period=annual&limit=5
   */
  async getIncomeStatement(
    ticker: string,
    period: 'annual' | 'quarter' = 'annual',
    limit: number = 5
  ): Promise<FMPIncomeStatement[]> {
    return this.fetch<FMPIncomeStatement[]>(`/income-statement`, {
      symbol: ticker.toUpperCase(),
      period,
      limit,
    });
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Get current rate limit status
   */
  /**
   * Check if circuit breaker is active (5+ consecutive 429s triggered a 60s pause)
   */
  isRateLimited(): boolean {
    return Date.now() < this.rateLimitPausedUntil;
  }

  getRateLimitStatus(): { requestsInWindow: number; windowResetMs: number; callsPerMinute: number } {
    const now = Date.now();
    return {
      requestsInWindow: this.requestCount,
      windowResetMs: Math.max(0, 60000 - (now - this.windowStart)),
      callsPerMinute: this.config.callsPerMinute,
    };
  }
}

// ============================================================================
// Type Definitions for FMP API Responses
// ============================================================================

export interface FMPTradableStock {
  symbol: string;
  name: string;
  price: number;
  exchange: string;
  exchangeShortName: string;
  type: string;
}

export interface FMPStockListItem {
  symbol: string;
  name: string;
  price: number;
  exchange: string;
  exchangeShortName: string;
  type: string;
}

export interface FMPProfile {
  symbol: string;
  companyName: string;
  currency: string;
  cik: string;
  isin: string;
  cusip: string;
  exchange: string;
  exchangeShortName: string;
  industry: string;
  sector: string;
  country: string;
  mktCap: number;
  price: number;
  beta: number;
  lastDiv: number;
  range: string;
  volAvg: number;
  changes: number;
  description: string;
  ceo: string;
  website: string;
  fullTimeEmployees: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  ipoDate: string;
  isActivelyTrading: boolean;
  isEtf: boolean;
  isFund: boolean;
  isAdr: boolean;
  defaultImage: boolean;
  image: string;
}

export interface FMPQuote {
  symbol: string;
  name: string;
  price: number;
  changesPercentage: number;
  change: number;
  dayLow: number;
  dayHigh: number;
  yearHigh: number;
  yearLow: number;
  marketCap: number;
  priceAvg50: number;
  priceAvg200: number;
  exchange: string;
  volume: number;
  avgVolume: number;
  open: number;
  previousClose: number;
  eps: number;
  pe: number;
  earningsAnnouncement: string;
  sharesOutstanding: number;
  timestamp: number;
}

export interface FMPKeyMetricsTTM {
  symbol?: string;

  // Market cap and enterprise value
  marketCap?: number;
  marketCapTTM?: number; // Legacy
  enterpriseValueTTM?: number;

  // EV ratios
  evToSalesTTM?: number;
  evToOperatingCashFlowTTM?: number;
  evToFreeCashFlowTTM?: number;
  evToEBITDATTM?: number;
  enterpriseValueOverEBITDATTM?: number; // Legacy

  // Debt ratios
  netDebtToEBITDATTM?: number;
  debtToEquityTTM?: number;
  debtToAssetsTTM?: number;

  // Liquidity
  currentRatioTTM?: number;
  incomeQualityTTM?: number;

  // Graham metrics
  grahamNumberTTM?: number;
  grahamNetNetTTM?: number;

  // Tax and interest burden
  taxBurdenTTM?: number;
  interestBurdenTTM?: number;
  interestCoverageTTM?: number;

  // Working capital
  workingCapitalTTM?: number;
  investedCapitalTTM?: number;

  // Return metrics (stable API field names)
  returnOnAssetsTTM?: number;
  operatingReturnOnAssetsTTM?: number;
  returnOnTangibleAssetsTTM?: number;
  returnOnEquityTTM?: number;
  returnOnInvestedCapitalTTM?: number;
  returnOnCapitalEmployedTTM?: number;

  // Legacy return field names
  roeTTM?: number;
  roicTTM?: number;

  // Yield metrics
  earningsYieldTTM?: number;
  freeCashFlowYieldTTM?: number;

  // Efficiency ratios
  capexToOperatingCashFlowTTM?: number;
  capexToDepreciationTTM?: number;
  capexToRevenueTTM?: number;
  salesGeneralAndAdministrativeToRevenueTTM?: number;
  researchAndDevelopementToRevenueTTM?: number;
  stockBasedCompensationToRevenueTTM?: number;
  intangiblesToTotalAssetsTTM?: number;

  // Receivables/Payables
  averageReceivablesTTM?: number;
  averagePayablesTTM?: number;
  averageInventoryTTM?: number;
  daysOfSalesOutstandingTTM?: number;
  daysSalesOutstandingTTM?: number; // Legacy
  daysOfPayablesOutstandingTTM?: number;
  daysPayablesOutstandingTTM?: number; // Legacy
  daysOfInventoryOutstandingTTM?: number;
  daysOfInventoryOnHandTTM?: number; // Legacy
  operatingCycleTTM?: number;
  cashConversionCycleTTM?: number;

  // Cash flow metrics
  freeCashFlowToEquityTTM?: number;
  freeCashFlowToFirmTTM?: number;

  // Asset values
  tangibleAssetValueTTM?: number;
  netCurrentAssetValueTTM?: number;

  // Turnover
  receivablesTurnoverTTM?: number;
  payablesTurnoverTTM?: number;
  inventoryTurnoverTTM?: number;

  // Per share metrics (some moved to ratios in stable API)
  revenuePerShareTTM?: number;
  netIncomePerShareTTM?: number;
  operatingCashFlowPerShareTTM?: number;
  freeCashFlowPerShareTTM?: number;
  cashPerShareTTM?: number;
  bookValuePerShareTTM?: number;
  tangibleBookValuePerShareTTM?: number;
  shareholdersEquityPerShareTTM?: number;
  interestDebtPerShareTTM?: number;
  capexPerShareTTM?: number;
  dividendPerShareTTM?: number;

  // Legacy ratio fields (moved to ratios-ttm in stable API)
  peRatioTTM?: number;
  priceToSalesRatioTTM?: number;
  pocfratioTTM?: number;
  pfcfRatioTTM?: number;
  pbRatioTTM?: number;
  ptbRatioTTM?: number;

  // Dividend fields
  dividendYieldTTM?: number;
  dividendYieldPercentageTTM?: number;
  payoutRatioTTM?: number;

  // Other
  debtToMarketCapTTM?: number;
}

export interface FMPKeyMetrics {
  symbol: string;
  date: string;
  calendarYear: string;
  period: string;
  revenuePerShare: number;
  netIncomePerShare: number;
  operatingCashFlowPerShare: number;
  freeCashFlowPerShare: number;
  cashPerShare: number;
  bookValuePerShare: number;
  tangibleBookValuePerShare: number;
  shareholdersEquityPerShare: number;
  interestDebtPerShare: number;
  marketCap: number;
  enterpriseValue: number;
  peRatio: number;
  priceToSalesRatio: number;
  pocfratio: number;
  pfcfRatio: number;
  pbRatio: number;
  ptbRatio: number;
  evToSales: number;
  enterpriseValueOverEBITDA: number;
  evToOperatingCashFlow: number;
  evToFreeCashFlow: number;
  earningsYield: number;
  freeCashFlowYield: number;
  debtToEquity: number;
  debtToAssets: number;
  netDebtToEBITDA: number;
  currentRatio: number;
  interestCoverage: number;
  incomeQuality: number;
  dividendYield: number;
  payoutRatio: number;
  salesGeneralAndAdministrativeToRevenue: number;
  researchAndDevelopementToRevenue: number;
  intangiblesToTotalAssets: number;
  capexToOperatingCashFlow: number;
  capexToRevenue: number;
  capexToDepreciation: number;
  stockBasedCompensationToRevenue: number;
  grahamNumber: number;
  roic: number;
  returnOnTangibleAssets: number;
  grahamNetNet: number;
  workingCapital: number;
  tangibleAssetValue: number;
  netCurrentAssetValue: number;
  investedCapital: number;
  averageReceivables: number;
  averagePayables: number;
  averageInventory: number;
  daysSalesOutstanding: number;
  daysPayablesOutstanding: number;
  daysOfInventoryOnHand: number;
  receivablesTurnover: number;
  payablesTurnover: number;
  inventoryTurnover: number;
  roe: number;
  capexPerShare: number;
}

export interface FMPRatiosTTM {
  symbol?: string;
  // Price ratios (stable API field names)
  priceToEarningsRatioTTM?: number;
  priceEarningsRatioTTM?: number; // Legacy field name
  priceToEarningsGrowthRatioTTM?: number;
  pegRatioTTM?: number; // Legacy field name
  forwardPriceToEarningsGrowthRatioTTM?: number;
  priceToBookRatioTTM?: number;
  priceBookValueRatioTTM?: number; // Legacy field name
  priceToSalesRatioTTM?: number;
  priceSalesRatioTTM?: number; // Legacy field name
  priceToFreeCashFlowRatioTTM?: number;
  priceToOperatingCashFlowRatioTTM?: number;
  priceCashFlowRatioTTM?: number;
  priceToFairValueTTM?: number;
  priceFairValueTTM?: number; // Legacy field name

  // Margins
  grossProfitMarginTTM?: number;
  ebitMarginTTM?: number;
  ebitdaMarginTTM?: number;
  operatingProfitMarginTTM?: number;
  pretaxProfitMarginTTM?: number;
  continuousOperationsProfitMarginTTM?: number;
  netProfitMarginTTM?: number;
  bottomLineProfitMarginTTM?: number;

  // Turnover ratios
  receivablesTurnoverTTM?: number;
  payablesTurnoverTTM?: number;
  inventoryTurnoverTTM?: number;
  fixedAssetTurnoverTTM?: number;
  assetTurnoverTTM?: number;

  // Liquidity ratios
  currentRatioTTM?: number;
  quickRatioTTM?: number;
  solvencyRatioTTM?: number;
  cashRatioTTM?: number;

  // Debt ratios
  debtToAssetsRatioTTM?: number;
  debtRatioTTM?: number; // Legacy
  debtToEquityRatioTTM?: number;
  debtEquityRatioTTM?: number; // Legacy
  debtToCapitalRatioTTM?: number;
  longTermDebtToCapitalizationTTM?: number;
  totalDebtToCapitalizationTTM?: number;
  financialLeverageRatioTTM?: number;
  companyEquityMultiplierTTM?: number; // Legacy

  // Operating ratios
  workingCapitalTurnoverRatioTTM?: number;
  operatingCashFlowRatioTTM?: number;
  operatingCashFlowSalesRatioTTM?: number;
  freeCashFlowOperatingCashFlowRatioTTM?: number;

  // Coverage ratios
  debtServiceCoverageRatioTTM?: number;
  interestCoverageRatioTTM?: number;
  interestCoverageTTM?: number; // Legacy
  shortTermOperatingCashFlowCoverageRatioTTM?: number;
  operatingCashFlowCoverageRatioTTM?: number;
  capitalExpenditureCoverageRatioTTM?: number;
  dividendPaidAndCapexCoverageRatioTTM?: number;
  cashFlowCoverageRatiosTTM?: number; // Legacy
  shortTermCoverageRatiosTTM?: number; // Legacy

  // Dividend ratios
  dividendPayoutRatioTTM?: number;
  payoutRatioTTM?: number; // Legacy
  dividendYieldTTM?: number;
  dividendYielTTM?: number; // Legacy
  dividendYielPercentageTTM?: number; // Legacy

  // Per share metrics
  revenuePerShareTTM?: number;
  netIncomePerShareTTM?: number;
  interestDebtPerShareTTM?: number;
  cashPerShareTTM?: number;
  bookValuePerShareTTM?: number;
  tangibleBookValuePerShareTTM?: number;
  shareholdersEquityPerShareTTM?: number;
  operatingCashFlowPerShareTTM?: number;
  capexPerShareTTM?: number;
  freeCashFlowPerShareTTM?: number;
  dividendPerShareTTM?: number;

  // Profitability ratios
  returnOnAssetsTTM?: number;
  returnOnEquityTTM?: number;
  returnOnCapitalEmployedTTM?: number;
  netIncomePerEBTTTM?: number;
  ebtPerEbitTTM?: number;

  // Other ratios
  effectiveTaxRateTTM?: number;
  enterpriseValueTTM?: number;
  enterpriseValueMultipleTTM?: number;
  debtToMarketCapTTM?: number;

  // Cycle ratios
  daysOfSalesOutstandingTTM?: number;
  daysOfInventoryOutstandingTTM?: number;
  operatingCycleTTM?: number;
  daysOfPayablesOutstandingTTM?: number;
  cashConversionCycleTTM?: number;

  // Legacy fields for backward compat
  ebitPerRevenueTTM?: number;
}

export interface FMPRatios {
  symbol: string;
  date: string;
  calendarYear: string;
  period: string;
  currentRatio: number;
  quickRatio: number;
  cashRatio: number;
  daysOfSalesOutstanding: number;
  daysOfInventoryOutstanding: number;
  operatingCycle: number;
  daysOfPayablesOutstanding: number;
  cashConversionCycle: number;
  grossProfitMargin: number;
  operatingProfitMargin: number;
  pretaxProfitMargin: number;
  netProfitMargin: number;
  effectiveTaxRate: number;
  returnOnAssets: number;
  returnOnEquity: number;
  returnOnCapitalEmployed: number;
  netIncomePerEBT: number;
  ebtPerEbit: number;
  ebitPerRevenue: number;
  debtRatio: number;
  debtEquityRatio: number;
  longTermDebtToCapitalization: number;
  totalDebtToCapitalization: number;
  interestCoverage: number;
  cashFlowToDebtRatio: number;
  companyEquityMultiplier: number;
  receivablesTurnover: number;
  payablesTurnover: number;
  inventoryTurnover: number;
  fixedAssetTurnover: number;
  assetTurnover: number;
  operatingCashFlowPerShare: number;
  freeCashFlowPerShare: number;
  cashPerShare: number;
  payoutRatio: number;
  operatingCashFlowSalesRatio: number;
  freeCashFlowOperatingCashFlowRatio: number;
  cashFlowCoverageRatios: number;
  shortTermCoverageRatios: number;
  capitalExpenditureCoverageRatio: number;
  dividendPaidAndCapexCoverageRatio: number;
  dividendPayoutRatio: number;
  priceBookValueRatio: number;
  priceToBookRatio: number;
  priceToSalesRatio: number;
  priceEarningsRatio: number;
  priceToFreeCashFlowsRatio: number;
  priceToOperatingCashFlowsRatio: number;
  priceCashFlowRatio: number;
  priceEarningsToGrowthRatio: number;
  priceSalesRatio: number;
  dividendYield: number;
  enterpriseValueMultiple: number;
  priceFairValue: number;
}

export interface FMPFinancialGrowth {
  symbol: string;
  date: string;
  calendarYear: string;
  period: string;
  revenueGrowth: number;
  grossProfitGrowth: number;
  ebitgrowth: number;
  operatingIncomeGrowth: number;
  netIncomeGrowth: number;
  epsgrowth: number;
  epsdilutedGrowth: number;
  weightedAverageSharesGrowth: number;
  weightedAverageSharesDilutedGrowth: number;
  dividendsperShareGrowth: number;
  operatingCashFlowGrowth: number;
  freeCashFlowGrowth: number;
  tenYRevenueGrowthPerShare: number;
  fiveYRevenueGrowthPerShare: number;
  threeYRevenueGrowthPerShare: number;
  tenYOperatingCFGrowthPerShare: number;
  fiveYOperatingCFGrowthPerShare: number;
  threeYOperatingCFGrowthPerShare: number;
  tenYNetIncomeGrowthPerShare: number;
  fiveYNetIncomeGrowthPerShare: number;
  threeYNetIncomeGrowthPerShare: number;
  tenYShareholdersEquityGrowthPerShare: number;
  fiveYShareholdersEquityGrowthPerShare: number;
  threeYShareholdersEquityGrowthPerShare: number;
  tenYDividendperShareGrowthPerShare: number;
  fiveYDividendperShareGrowthPerShare: number;
  threeYDividendperShareGrowthPerShare: number;
  receivablesGrowth: number;
  inventoryGrowth: number;
  assetGrowth: number;
  bookValueperShareGrowth: number;
  debtGrowth: number;
  rdexpenseGrowth: number;
  sgaexpensesGrowth: number;
}

// New stable API response format (Aug 2025+)
export interface FMPHistoricalPriceStable {
  symbol: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  change: number;
  changePercent: number;
  vwap: number;
}

// Legacy format (converted from stable API for backward compatibility)
export interface FMPHistoricalPrice {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  adjClose: number;
  volume: number;
  unadjustedVolume: number;
  change: number;
  changePercent: number;
  vwap: number;
  label: string;
  changeOverTime: number;
}

export interface FMPHistoricalPriceResponse {
  symbol: string;
  historical: FMPHistoricalPrice[];
}

export interface FMPBatchEODPrice {
  symbol: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  adjClose: number;
  volume: number;
  unadjustedVolume: number;
  change: number;
  changePercent: number;
  vwap: number;
}

export interface FMPTechnicalIndicator {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  sma?: number;
  ema?: number;
  wma?: number;
  rsi?: number;
  adx?: number;
  standardDeviation?: number;
  williams?: number;
}

export interface FMPPriceTargetConsensus {
  symbol: string;
  targetHigh: number;
  targetLow: number;
  targetConsensus: number;
  targetMedian: number;
}

export interface FMPAnalystEstimate {
  symbol: string;
  date: string;
  estimatedRevenueLow: number;
  estimatedRevenueHigh: number;
  estimatedRevenueAvg: number;
  estimatedEbitdaLow: number;
  estimatedEbitdaHigh: number;
  estimatedEbitdaAvg: number;
  estimatedEbitLow: number;
  estimatedEbitHigh: number;
  estimatedEbitAvg: number;
  estimatedNetIncomeLow: number;
  estimatedNetIncomeHigh: number;
  estimatedNetIncomeAvg: number;
  estimatedSgaExpenseLow: number;
  estimatedSgaExpenseHigh: number;
  estimatedSgaExpenseAvg: number;
  estimatedEpsAvg: number;
  estimatedEpsHigh: number;
  estimatedEpsLow: number;
  numberAnalystEstimatedRevenue: number;
  numberAnalystsEstimatedEps: number;
}

export interface FMPDCFData {
  symbol: string;
  date: string;
  dcf: number;           // Fair value per share
  'Stock Price': number; // Current stock price
}

export interface FMPHistoricalDCF {
  symbol: string;
  date: string;
  dcf: number;
  price: number;
}

export interface FMPIncomeStatement {
  date: string;
  symbol: string;
  reportedCurrency: string;
  cik: string;
  fillingDate: string;
  acceptedDate: string;
  calendarYear: string;
  period: string;
  revenue: number;
  costOfRevenue: number;
  grossProfit: number;
  grossProfitRatio: number;
  researchAndDevelopmentExpenses: number;
  generalAndAdministrativeExpenses: number;
  sellingAndMarketingExpenses: number;
  sellingGeneralAndAdministrativeExpenses: number;
  otherExpenses: number;
  operatingExpenses: number;
  costAndExpenses: number;
  interestIncome: number;
  interestExpense: number;
  depreciationAndAmortization: number;
  ebitda: number;
  ebitdaratio: number;
  operatingIncome: number;
  operatingIncomeRatio: number;
  totalOtherIncomeExpensesNet: number;
  incomeBeforeTax: number;
  incomeBeforeTaxRatio: number;
  incomeTaxExpense: number;
  netIncome: number;
  netIncomeRatio: number;
  eps: number;
  epsdiluted: number;
  weightedAverageShsOut: number;
  weightedAverageShsOutDil: number;
  link: string;
  finalLink: string;
}

// ============================================================================
// Default Export - Singleton Instance
// ============================================================================

let defaultClient: FMPClient | null = null;

export function getFMPClient(config?: FMPClientConfig): FMPClient {
  if (!defaultClient || config) {
    defaultClient = new FMPClient(config);
  }
  return defaultClient;
}

export default FMPClient;
