import { describe, expect, it } from "vitest";
import {
  computeLiquidityScore,
  computeTimeRemainingScore,
  scoreOpportunity,
} from "./market-selection";
import type { AgentMarket, RiskDecision } from "./types";

const market: AgentMarket = {
  marketId: "market-1",
  question: "Will this happen?",
  yesTokenId: "yes-token",
  noTokenId: "no-token",
  bestBid: 0.5,
  bestAsk: 0.52,
  spread: 0.02,
  midpoint: 0.51,
  volume24h: 50000,
  liquidity: 25000,
  expiresAt: new Date("2026-01-04T00:00:00Z"),
  orderbookUpdatedAt: new Date("2026-01-01T00:00:00Z"),
};

const risk: RiskDecision = {
  allowed: true,
  reasons: [],
  intent: {
    marketId: "market-1",
    tokenId: "yes-token",
    outcome: "yes",
    side: "buy",
    limitPrice: 0.52,
    sizeUsd: 50,
    edge: 0.08,
    estimatedProbability: 0.6,
    confidence: 0.85,
    rationale: ["test"],
  },
  diagnostics: {
    buyEdge: 0.08,
    sellEdge: -0.1,
    selectedEdge: 0.08,
    kellyFraction: 0.01,
    cappedSizeUsd: 50,
    drawdownPct: 0,
    marketDataStatus: "fresh",
  },
};

describe("market selection scoring", () => {
  it("scores liquidity on a bounded scale", () => {
    expect(computeLiquidityScore(0)).toBe(0);
    expect(computeLiquidityScore(50_000)).toBe(1);
    expect(computeLiquidityScore(500_000)).toBe(1);
  });

  it("favors markets with actionable but not expired time horizons", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    expect(
      computeTimeRemainingScore(new Date("2025-12-31T00:00:00Z"), now)
    ).toBe(0);
    expect(
      computeTimeRemainingScore(new Date("2026-01-01T03:00:00Z"), now)
    ).toBeCloseTo(0.5);
    expect(
      computeTimeRemainingScore(new Date("2026-01-03T00:00:00Z"), now)
    ).toBe(1);
  });

  it("combines edge, confidence, liquidity, and time remaining", () => {
    const score = scoreOpportunity(
      market,
      risk,
      undefined,
      new Date("2026-01-01T00:00:00Z")
    );

    expect(score.total).toBeGreaterThan(0.6);
    expect(score.edgeScore).toBeCloseTo(0.4);
    expect(score.confidenceScore).toBe(0.85);
    expect(score.timeRemainingScore).toBe(1);
  });
});
