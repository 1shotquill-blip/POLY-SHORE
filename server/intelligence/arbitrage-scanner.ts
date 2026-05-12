import { invokeLLM } from "../_core/llm";
import type { AgentMarket, TradeIntent } from "../agent/types";
import { fetchArbsXyzOpportunities } from "./arbs-feed";

export interface ArbitrageScanOptions {
  /** Maximum total cost (yes + no) to qualify as an opportunity. Default 0.98 */
  maxTotalCost?: number;
  /** Minimum liquidity (USD) for each leg. Default 0 */
  minLiquidityUsd?: number;
  /** Minimum 24h volume (USD) for each leg. Default 0 */
  minVolume24hUsd?: number;
  /** Maximum hours until market expiry. 0 = no limit */
  maxHoursToExpiry?: number;
}

export interface CrossExchangeArbitrageOpportunity {
  anomalyType: "cross_exchange_arbitrage";
  /** Where this opportunity was discovered */
  source: "internal" | "arbs_xyz";
  polymarket: AgentMarket;
  kalshi: AgentMarket;
  semanticMatchConfidence: number;
  polymarketYesPrice: number;
  kalshiNoPrice: number;
  gap: number;
  intents: [TradeIntent, TradeIntent];
}

interface SemanticMatch {
  polymarketId: string;
  kalshiId: string;
  confidence: number;
}

const semanticCache = new Map<string, SemanticMatch[]>();

function cacheKey(polymarket: AgentMarket[], kalshi: AgentMarket[]): string {
  return [
    ...polymarket.map(market => market.marketId).sort(),
    "::",
    ...kalshi.map(market => market.marketId).sort(),
  ].join("|");
}

function parseLLMText(result: Awaited<ReturnType<typeof invokeLLM>>): string {
  const content = result.choices[0]?.message.content;
  if (typeof content === "string") return content;
  return (content ?? [])
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map(part => part.text)
    .join("");
}

async function matchMarketsSemantically(
  polymarket: AgentMarket[],
  kalshi: AgentMarket[]
): Promise<SemanticMatch[]> {
  const key = cacheKey(polymarket, kalshi);
  const cached = semanticCache.get(key);
  if (cached) return cached;

  if (polymarket.length === 0 || kalshi.length === 0) return [];
  const result = await invokeLLM({
    messages: [
      {
        role: "system",
        content:
          "Match prediction markets that ask the same real-world question. Return only high-confidence equivalent pairs.",
      },
      {
        role: "user",
        content: JSON.stringify({
          polymarket: polymarket.slice(0, 30).map(market => ({
            id: market.marketId,
            question: market.question,
          })),
          kalshi: kalshi.slice(0, 30).map(market => ({
            id: market.marketId,
            question: market.question,
          })),
        }),
      },
    ],
    outputSchema: {
      name: "cross_exchange_market_matches",
      schema: {
        type: "object",
        properties: {
          matches: {
            type: "array",
            items: {
              type: "object",
              properties: {
                polymarketId: { type: "string" },
                kalshiId: { type: "string" },
                confidence: { type: "number" },
              },
              required: ["polymarketId", "kalshiId", "confidence"],
              additionalProperties: false,
            },
          },
        },
        required: ["matches"],
        additionalProperties: false,
      },
      strict: true,
    },
  });
  const parsed = JSON.parse(parseLLMText(result)) as { matches?: SemanticMatch[] };
  const matches = (parsed.matches ?? []).filter(match => match.confidence >= 0.75);
  semanticCache.set(key, matches);
  return matches;
}

function buildIntent(
  market: AgentMarket,
  outcome: "yes" | "no",
  limitPrice: number
): TradeIntent {
  return {
    exchange: market.exchange,
    marketId: market.marketId,
    tokenId: outcome === "yes" ? market.yesTokenId : market.noTokenId,
    outcome,
    side: "buy",
    limitPrice,
    sizeUsd: 1,
    edge: 0,
    estimatedProbability: outcome === "yes" ? limitPrice : 1 - limitPrice,
    confidence: 1,
    rationale: ["cross_exchange_arbitrage"],
  };
}

export async function scanCrossExchangeArbitrage(
  markets: AgentMarket[],
  options: ArbitrageScanOptions = {}
): Promise<CrossExchangeArbitrageOpportunity[]> {
  const {
    maxTotalCost = 0.98,
    minLiquidityUsd = 0,
    minVolume24hUsd = 0,
    maxHoursToExpiry = 0,
  } = options;

  const now = Date.now();
  const expiryDeadline = maxHoursToExpiry > 0
    ? now + maxHoursToExpiry * 3_600_000
    : Infinity;

  function meetsFilters(market: AgentMarket): boolean {
    if (market.liquidity < minLiquidityUsd) return false;
    if (market.volume24h < minVolume24hUsd) return false;
    if (expiryDeadline !== Infinity && market.expiresAt.getTime() > expiryDeadline) return false;
    return true;
  }

  const polymarket = markets.filter(
    market => market.exchange === "polymarket" && meetsFilters(market)
  );
  const kalshi = markets.filter(
    market => market.exchange === "kalshi" && meetsFilters(market)
  );
  const matches = await matchMarketsSemantically(polymarket, kalshi);
  const byPolymarket = new Map(polymarket.map(market => [market.marketId, market]));
  const byKalshi = new Map(kalshi.map(market => [market.marketId, market]));
  const opportunities: CrossExchangeArbitrageOpportunity[] = [];

  for (const match of matches) {
    const poly = byPolymarket.get(match.polymarketId);
    const kalshiMarket = byKalshi.get(match.kalshiId);
    if (!poly || !kalshiMarket) continue;
    const polymarketYesPrice = poly.bestAsk;
    const kalshiNoPrice = Math.max(0.01, Math.min(0.99, 1 - kalshiMarket.bestBid));
    const totalCost = polymarketYesPrice + kalshiNoPrice;
    if (totalCost < maxTotalCost) {
      opportunities.push({
        anomalyType: "cross_exchange_arbitrage",
        source: "internal",
        polymarket: poly,
        kalshi: kalshiMarket,
        semanticMatchConfidence: match.confidence,
        polymarketYesPrice,
        kalshiNoPrice,
        gap: maxTotalCost - totalCost,
        intents: [
          buildIntent(poly, "yes", polymarketYesPrice),
          buildIntent(kalshiMarket, "no", kalshiNoPrice),
        ],
      });
    }
  }

  // Merge external arbs.xyz feed — deduplicate by polymarket+kalshi market pair
  const externalOpportunities = await fetchArbsXyzOpportunities();
  const internalKeys = new Set(
    opportunities.map(o => `${o.polymarket.marketId}::${o.kalshi.marketId}`)
  );
  for (const ext of externalOpportunities) {
    const key = `${ext.polymarket.marketId}::${ext.kalshi.marketId}`;
    if (!internalKeys.has(key)) {
      opportunities.push(ext);
      internalKeys.add(key);
    }
  }

  opportunities.sort((a, b) => b.gap - a.gap);
  console.log(
    `[ArbitrageScanner] matched_pairs=${matches.length}; internal=${opportunities.filter(o => o.source === "internal").length}; external=${externalOpportunities.length}; threshold=${maxTotalCost}`
  );
  return opportunities;
}
