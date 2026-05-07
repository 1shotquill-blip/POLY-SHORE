import { describe, expect, it, vi } from "vitest";
import { RuleBasedIntelligenceEngine } from "./intelligence";
import { AgentOrchestrator } from "./orchestrator";
import { PaperExecutionAdapter } from "./paper-execution";
import type { AgentMarket, PortfolioSnapshot } from "./types";

vi.mock("./order-persistence", () => ({
  persistPaperOrderIntent: vi.fn(),
  persistLifecycleUpdate: vi.fn(),
}));

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
  liquidity: 10000,
  expiresAt: new Date(Date.now() + 86_400_000),
  orderbookUpdatedAt: new Date("2026-01-01T00:00:00Z"),
  category: "politics",
};

const cleanPortfolio: PortfolioSnapshot = {
  bankrollUsd: 1000,
  peakBankrollUsd: 1000,
  openExposureUsd: 0,
  dailyPnlUsd: 0,
  marketExposureUsd: {},
  categoryExposureUsd: {},
  openOrderCount: 0,
  reconciliationStatus: "ok",
};

describe("agent orchestrator", () => {
  it("submits a paper order only after intelligence and risk pass", async () => {
    const orchestrator = new AgentOrchestrator({
      marketProvider: { scan: async () => [market] },
      portfolioProvider: { snapshot: async () => cleanPortfolio },
      intelligence: new RuleBasedIntelligenceEngine([
        {
          marketId: "market-1",
          probability: 0.65,
          confidence: 0.85,
          evidence: ["strong test signal"],
        },
      ]),
      execution: new PaperExecutionAdapter(),
      persistOrders: false,
    });

    const result = await orchestrator.tick(new Date("2026-01-01T00:00:00Z"));

    expect(result.submittedOrders).toBe(1);
    expect(result.audits[0]?.action).toBe("paper_order_submitted");
    expect(result.audits[0]?.lifecycleUpdate?.status).toBe("filled");
  });

  it("skips when no high-confidence intelligence decision exists", async () => {
    const orchestrator = new AgentOrchestrator({
      marketProvider: { scan: async () => [market] },
      portfolioProvider: { snapshot: async () => cleanPortfolio },
      intelligence: new RuleBasedIntelligenceEngine(),
      persistOrders: false,
    });

    const result = await orchestrator.tick(new Date("2026-01-01T00:00:00Z"));

    expect(result.submittedOrders).toBe(0);
    expect(result.audits[0]?.reasons).toContain("no high-confidence ensemble decision");
  });

  it("skips all markets when reconciliation is not clean", async () => {
    const orchestrator = new AgentOrchestrator({
      marketProvider: { scan: async () => [market] },
      portfolioProvider: {
        snapshot: async () => ({
          ...cleanPortfolio,
          reconciliationStatus: "mismatch",
        }),
      },
      intelligence: new RuleBasedIntelligenceEngine([
        {
          marketId: "market-1",
          probability: 0.8,
          confidence: 0.9,
          evidence: ["would otherwise pass"],
        },
      ]),
      persistOrders: false,
    });

    const result = await orchestrator.tick(new Date("2026-01-01T00:00:00Z"));

    expect(result.submittedOrders).toBe(0);
    expect(result.audits[0]?.reasons).toContain("portfolio reconciliation is not clean");
  });
});
