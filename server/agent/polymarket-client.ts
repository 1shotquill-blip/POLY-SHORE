import type { AgentMarket } from "./types";

const GAMMA_HOST = "https://gamma-api.polymarket.com";
const CLOB_HOST = "https://clob.polymarket.com";

export interface HttpClient {
  fetch(input: string | URL, init?: RequestInit): Promise<Response>;
}

export interface GammaMarketResponse {
  id?: string | number;
  conditionId?: string;
  question?: string;
  description?: string;
  category?: string;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  enableOrderBook?: boolean;
  clobTokenIds?: string[] | string;
  outcomes?: string[] | string;
  volume24hr?: string | number;
  volume24h?: string | number;
  volume?: string | number;
  liquidity?: string | number;
  endDate?: string;
  endDateIso?: string;
  resolutionSource?: string;
}

export interface ClobBookLevel {
  price: string;
  size: string;
}

export interface ClobOrderBookResponse {
  market?: string;
  asset_id?: string;
  timestamp?: string | number;
  bids?: ClobBookLevel[];
  asks?: ClobBookLevel[];
  min_order_size?: string;
  tick_size?: string;
  neg_risk?: boolean;
  last_trade_price?: string;
}

export interface MarketScanOptions {
  limit: number;
  offset?: number;
  gammaHost?: string;
  clobHost?: string;
  minVolume24h?: number;
  minLiquidity?: number;
  httpClient?: HttpClient;
}

export function parseJsonArray(value: string[] | string | undefined): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (!value) return [];

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  }
}

export function toNumber(value: string | number | undefined, fallback = 0): number {
  if (value === undefined || value === null) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function parseTimestamp(value: string | number | undefined, fallback: Date): Date {
  if (value === undefined || value === null || value === "") return fallback;

  if (typeof value === "number" || /^\d+$/.test(value)) {
    const numeric = Number(value);
    const millis = numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? fallback : date;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

export function getBestBid(book: ClobOrderBookResponse): number {
  const prices = (book.bids ?? []).map((level) => toNumber(level.price, Number.NaN)).filter(Number.isFinite);
  return prices.length > 0 ? Math.max(...prices) : Number.NaN;
}

export function getBestAsk(book: ClobOrderBookResponse): number {
  const prices = (book.asks ?? []).map((level) => toNumber(level.price, Number.NaN)).filter(Number.isFinite);
  return prices.length > 0 ? Math.min(...prices) : Number.NaN;
}

export function computeVisibleLiquidityUsd(book: ClobOrderBookResponse, levels = 5): number {
  const sideValue = (side: ClobBookLevel[] | undefined) =>
    (side ?? [])
      .slice(0, levels)
      .reduce((sum, level) => sum + toNumber(level.price) * toNumber(level.size), 0);

  return sideValue(book.bids) + sideValue(book.asks);
}

export function normalizeGammaMarket(gamma: GammaMarketResponse): GammaMarketResponse | null {
  if (gamma.active === false || gamma.closed === true || gamma.archived === true) return null;
  if (gamma.enableOrderBook === false) return null;
  if (!gamma.question) return null;

  const tokenIds = parseJsonArray(gamma.clobTokenIds);
  if (tokenIds.length < 2) return null;

  return gamma;
}

export function normalizeAgentMarket(gamma: GammaMarketResponse, yesBook: ClobOrderBookResponse, fetchedAt = new Date()): AgentMarket | null {
  const normalized = normalizeGammaMarket(gamma);
  if (!normalized) return null;

  const tokenIds = parseJsonArray(normalized.clobTokenIds);
  const bestBid = getBestBid(yesBook);
  const bestAsk = getBestAsk(yesBook);
  if (!Number.isFinite(bestBid) || !Number.isFinite(bestAsk)) return null;

  const expiresAt = parseTimestamp(normalized.endDateIso ?? normalized.endDate, new Date(0));
  const orderbookUpdatedAt = parseTimestamp(yesBook.timestamp, fetchedAt);
  const spread = bestAsk - bestBid;
  const visibleLiquidity = computeVisibleLiquidityUsd(yesBook);
  const gammaLiquidity = toNumber(normalized.liquidity);

  return {
    marketId: String(normalized.id ?? yesBook.market ?? ""),
    conditionId: normalized.conditionId,
    question: normalized.question ?? "",
    resolutionCriteria: normalized.resolutionSource ?? normalized.description,
    category: normalized.category,
    yesTokenId: tokenIds[0],
    noTokenId: tokenIds[1],
    bestBid,
    bestAsk,
    spread,
    midpoint: (bestBid + bestAsk) / 2,
    volume24h: toNumber(normalized.volume24hr, toNumber(normalized.volume24h, toNumber(normalized.volume))),
    liquidity: Math.max(gammaLiquidity, visibleLiquidity),
    expiresAt,
    orderbookUpdatedAt,
    negRisk: yesBook.neg_risk,
  };
}

export async function fetchGammaMarkets(options: MarketScanOptions): Promise<GammaMarketResponse[]> {
  const params = new URLSearchParams({
    active: "true",
    closed: "false",
    limit: String(options.limit),
    offset: String(options.offset ?? 0),
  });
  const host = options.gammaHost ?? GAMMA_HOST;
  const http = options.httpClient ?? { fetch };
  const response = await http.fetch(`${host}/markets?${params}`);

  if (!response.ok) {
    throw new Error(`Gamma markets request failed (${response.status} ${response.statusText})`);
  }

  const body = (await response.json()) as unknown;
  if (!Array.isArray(body)) {
    throw new Error("Gamma markets response was not an array");
  }

  return body as GammaMarketResponse[];
}

export async function fetchClobOrderBook(tokenId: string, options: Pick<MarketScanOptions, "clobHost" | "httpClient"> = {}): Promise<ClobOrderBookResponse> {
  const params = new URLSearchParams({ token_id: tokenId });
  const host = options.clobHost ?? CLOB_HOST;
  const http = options.httpClient ?? { fetch };
  const response = await http.fetch(`${host}/book?${params}`);

  if (!response.ok) {
    throw new Error(`CLOB book request failed (${response.status} ${response.statusText})`);
  }

  return (await response.json()) as ClobOrderBookResponse;
}

export async function scanPolymarketCandidates(options: MarketScanOptions): Promise<AgentMarket[]> {
  const fetchedAt = new Date();
  const gammaMarkets = await fetchGammaMarkets(options);
  const normalizedGamma = gammaMarkets
    .map(normalizeGammaMarket)
    .filter((market): market is GammaMarketResponse => Boolean(market))
    .filter((market) => toNumber(market.volume24hr, toNumber(market.volume24h, toNumber(market.volume))) >= (options.minVolume24h ?? 0))
    .filter((market) => toNumber(market.liquidity) >= (options.minLiquidity ?? 0));

  const candidates: AgentMarket[] = [];

  for (const market of normalizedGamma) {
    const [yesTokenId] = parseJsonArray(market.clobTokenIds);
    if (!yesTokenId) continue;

    const book = await fetchClobOrderBook(yesTokenId, options);
    const agentMarket = normalizeAgentMarket(market, book, fetchedAt);
    if (agentMarket) candidates.push(agentMarket);
  }

  return candidates;
}
