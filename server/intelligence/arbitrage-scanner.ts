import { invokeLLM } from "../_core/llm";
import type { AgentMarket, TradeIntent } from "../agent/types";

export interface CrossExchangeArbitrageOpportunity {
  anomalyType: "cross_exchange_arbitrage";
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
  markets: AgentMarket[]
): Promise<CrossExchangeArbitrageOpportunity[]> {
  const polymarket = markets.filter(market => market.exchange === "polymarket");
  const kalshi = markets.filter(market => market.exchange === "kalshi");
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
    if (totalCost < 0.98) {
      opportunities.push({
        anomalyType: "cross_exchange_arbitrage",
        polymarket: poly,
        kalshi: kalshiMarket,
        semanticMatchConfidence: match.confidence,
        polymarketYesPrice,
        kalshiNoPrice,
        gap: 0.98 - totalCost,
        intents: [
          buildIntent(poly, "yes", polymarketYesPrice),
          buildIntent(kalshiMarket, "no", kalshiNoPrice),
        ],
      });
    }
  }

  opportunities.sort((a, b) => b.gap - a.gap);
  console.log(
    `[ArbitrageScanner] matched_pairs=${matches.length}; opportunities=${opportunities.length}`
  );
  return opportunities;
}
