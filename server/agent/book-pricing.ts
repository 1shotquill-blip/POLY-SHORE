import type { AgentMarket } from "./types";

function clampFinitePrice(value: number): number {
  return Number.isFinite(value) ? value : Number.NaN;
}

export function getClobReferencePrice(market: AgentMarket): number {
  const bestBid = clampFinitePrice(market.bestBid);
  const bestAsk = clampFinitePrice(market.bestAsk);
  if (!Number.isFinite(bestBid) || !Number.isFinite(bestAsk)) return Number.NaN;
  if (bestBid < 0 || bestAsk > 1 || bestBid >= bestAsk) return Number.NaN;
  return (bestBid + bestAsk) / 2;
}

export function getClobSpreadBps(market: AgentMarket): number {
  const referencePrice = getClobReferencePrice(market);
  if (!Number.isFinite(referencePrice) || referencePrice <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return (market.spread / referencePrice) * 10_000;
}
