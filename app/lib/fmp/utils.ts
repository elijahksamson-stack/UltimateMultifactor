/**
 * Utility functions for scrapers
 * Ported from Python implementation
 */

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Unit multipliers for K, M, B, T suffixes
 */
const UNIT_MULTIPLIERS: Record<string, number> = {
  K: 1e3,
  M: 1e6,
  B: 1e9,
  T: 1e12,
};

/**
 * Regex patterns for value extraction
 */
const PERCENT_REGEX = /([-+]?\d+(?:\.\d+)?)\s*%/g;
const NUMBER_REGEX = /([-+]?\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+\.\d+|\d+)/;
const SUFFIXED_NUMBER_REGEX = /([-+]?\d+(?:\.\d+)?)\s*([KMBT])$/i;

/**
 * Extract the last percentage value from a string
 * Example: "15.3%" → 15.3, "Price -2.5% Volume +3.1%" → 3.1
 */
function pickLastPercent(str: string): number | null {
  const matches = Array.from(str.matchAll(PERCENT_REGEX));
  if (matches.length === 0) return null;

  const lastMatch = matches[matches.length - 1];
  return parseFloat(lastMatch[1]);
}

/**
 * Extract the first number from a string
 * Example: "1,234.56" → 1234.56
 */
function pickFirstNumber(str: string): number | null {
  const match = str.match(NUMBER_REGEX);
  if (!match) return null;

  return parseFloat(match[1].replace(/,/g, ''));
}

/**
 * Coerce a Finviz value string to a number
 * Handles:
 * - Percentages: "15.3%" → 15.3
 * - Suffixes: "1.5B" → 1500000000
 * - Numbers with commas: "1,234.56" → 1234.56
 * - Special values: "N/A", "-", "" → null
 *
 * This is the critical function that mirrors Python's _coerce_value()
 */
export function coerceFinvizValue(value: string | null | undefined): number | null {
  // Handle null/undefined
  if (value == null) return null;

  // Normalize string
  const str = String(value).trim().toUpperCase();

  // Handle empty or special values
  if (str === '' || str === 'N/A' || str === 'NA' || str === '-') {
    return null;
  }

  // Try percentage first
  const percent = pickLastPercent(str);
  if (percent !== null) {
    return percent;
  }

  // Try suffixed number (e.g., "1.5B")
  const suffixMatch = str.match(SUFFIXED_NUMBER_REGEX);
  if (suffixMatch) {
    const value = parseFloat(suffixMatch[1]);
    const suffix = suffixMatch[2].toUpperCase();
    const multiplier = UNIT_MULTIPLIERS[suffix];

    if (multiplier) {
      return value * multiplier;
    }
  }

  // Try regular number
  const number = pickFirstNumber(str);
  return number;
}

/**
 * Normalize a Finviz table key (remove non-breaking spaces, trim)
 */
export function normalizeFinvizKey(key: string): string {
  return key.trim().replace(/\xa0/g, ' ');
}

/**
 * Calculate exponential backoff delay
 */
export function getBackoffDelay(attempt: number, baseDelay: number = 1000): number {
  return baseDelay * Math.pow(2, attempt);
}

/**
 * Retry a function with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    baseDelay?: number;
    onRetry?: (attempt: number, error: Error) => void;
  } = {}
): Promise<T> {
  const { maxRetries = 3, baseDelay = 1000, onRetry } = options;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt < maxRetries) {
        const delay = getBackoffDelay(attempt, baseDelay);

        if (onRetry) {
          onRetry(attempt + 1, lastError);
        }

        await sleep(delay);
      }
    }
  }

  throw lastError;
}

/**
 * Calculate Simple Moving Average
 */
export function calculateSMA(values: number[], window: number): number | null {
  if (values.length < window) return null;

  const slice = values.slice(-window);
  const sum = slice.reduce((acc, val) => acc + val, 0);

  return sum / window;
}

/**
 * Calculate Exponential Moving Average
 */
export function calculateEMA(values: number[], span: number): number | null {
  if (values.length === 0) return null;

  // Initialize with first value
  let ema = values[0];
  const multiplier = 2 / (span + 1);

  for (let i = 1; i < values.length; i++) {
    ema = (values[i] - ema) * multiplier + ema;
  }

  return ema;
}

/**
 * Format a number with commas
 */
export function formatNumber(num: number, decimals: number = 2): string {
  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Safe JSON stringify that handles circular references
 */
export function safeStringify(obj: any, indent: number = 2): string {
  const seen = new WeakSet();

  return JSON.stringify(
    obj,
    (key, value) => {
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return '[Circular]';
        }
        seen.add(value);
      }
      return value;
    },
    indent
  );
}

/**
 * Check if a status code should trigger a retry
 */
export function shouldRetryStatus(statusCode: number): boolean {
  return [403, 429, 500, 502, 503, 504].includes(statusCode);
}

/**
 * Extract ticker symbol from various formats
 */
export function normalizeTicker(ticker: string): string {
  return ticker.trim().toUpperCase();
}

/**
 * Create a rate limiter
 */
export function createRateLimiter(delayMs: number) {
  let lastCallTime = 0;

  return async function rateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastCall = now - lastCallTime;

    if (timeSinceLastCall < delayMs) {
      await sleep(delayMs - timeSinceLastCall);
    }

    lastCallTime = Date.now();
  };
}
