import { upsertMarket, getMarketByMarketId } from "./db";
import type { InsertMarket } from "../drizzle/schema";

/**
 * Market Data Ingestion: Fetch from Gamma API, cache orderbooks, filter by thresholds
 */

export interface GammaMarket {
  id: string;
  question: string;
  category?: string;
  volume24h: number;
  bestBid: number;
  bestAsk: number;
  expiresAt: string;
}

export interface OrderbookSnapshot {
  marketId: string;
  bestBid: number;
  bestAsk: number;
  spread: number;
  timestamp: Date;
}

/**
 * Fetch eligible markets from Gamma API
 * Filters by volume and spread thresholds
 */
export async function fetchEligibleMarkets(
  minVolume: number,
  maxSpread: number,
  minTimeToExpiry: number = 3600 // seconds
): Promise<GammaMarket[]> {
  try {
    // TODO: Implement actual Gamma API call
    // const response = await fetch("https://gamma-api.polymarket.com/markets", {
    //   headers: { "Content-Type": "application/json" },
    // });
    // const markets = await response.json();

    // Stub: return empty array for now
    console.log("[Ingestion] Fetching markets from Gamma API (stubbed)");
    return [];
  } catch (error) {
    console.error("[Ingestion] Error fetching markets:", error);
    return [];
  }
}

/**
 * Cache market data in database
 */
export async function cacheMarketData(market: GammaMarket): Promise<void> {
  const spread = market.bestAsk - market.bestBid;
  const marketData: InsertMarket = {
    marketId: market.id,
    question: market.question,
    category: market.category,
    volume24h: market.volume24h.toString(),
    bestBid: market.bestBid.toString(),
    bestAsk: market.bestAsk.toString(),
    spread: spread.toString(),
    expiresAt: new Date(market.expiresAt),
  };

  await upsertMarket(marketData);
}

/**
 * Filter markets by volume and spread
 */
export function filterMarketsByThresholds(
  markets: GammaMarket[],
  minVolume: number,
  maxSpread: number
): GammaMarket[] {
  return markets.filter((m) => {
    const spread = m.bestAsk - m.bestBid;
    return m.volume24h >= minVolume && spread <= maxSpread;
  });
}

/**
 * Check if orderbook is stale (>10 seconds old)
 */
export function isOrderbookStale(snapshot: OrderbookSnapshot, maxAgeSeconds: number = 10): boolean {
  const ageSeconds = (Date.now() - snapshot.timestamp.getTime()) / 1000;
  return ageSeconds > maxAgeSeconds;
}

/**
 * Fetch and cache all eligible markets
 */
export async function ingestMarketData(minVolume: number, maxSpread: number): Promise<GammaMarket[]> {
  const markets = await fetchEligibleMarkets(minVolume, maxSpread);
  const filtered = filterMarketsByThresholds(markets, minVolume, maxSpread);

  for (const market of filtered) {
    await cacheMarketData(market);
  }

  console.log(`[Ingestion] Cached ${filtered.length} markets`);
  return filtered;
}

/**
 * Get market data from cache
 */
export async function getMarketData(marketId: string): Promise<GammaMarket | null> {
  const cached = await getMarketByMarketId(marketId);
  if (!cached) return null;

  return {
    id: cached.marketId,
    question: cached.question,
    category: cached.category || undefined,
    volume24h: Number(cached.volume24h),
    bestBid: Number(cached.bestBid),
    bestAsk: Number(cached.bestAsk),
    expiresAt: cached.expiresAt?.toISOString() || new Date().toISOString(),
  };
}
