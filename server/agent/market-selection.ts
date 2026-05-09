import type { AgentMarket, RiskDecision } from "./types";

export interface MarketSelectionWeights {
  edge: number;
  confidence: number;
  liquidity: number;
  timeRemaining: number;
}

export const DEFAULT_MARKET_SELECTION_WEIGHTS: MarketSelectionWeights = {
  edge: 0.45,
  confidence: 0.3,
  liquidity: 0.15,
  timeRemaining: 0.1,
};

export interface MarketSelectionScore {
  total: number;
  edgeScore: number;
  confidenceScore: number;
  liquidityScore: number;
  timeRemainingScore: number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function computeLiquidityScore(liquidityUsd: number): number {
  if (liquidityUsd <= 0) return 0;
  // Saturates around $50k visible/declared liquidity.
  return clamp01(Math.log10(liquidityUsd + 1) / Math.log10(50_000 + 1));
}

export function computeTimeRemainingScore(
  expiresAt: Date,
  now = new Date()
): number {
  const hoursRemaining = (expiresAt.getTime() - now.getTime()) / 3_600_000;
  if (hoursRemaining <= 0) return 0;
  // Favor markets with enough time for edge to materialize, but do not reward very long horizons indefinitely.
  if (hoursRemaining < 6) return hoursRemaining / 6;
  if (hoursRemaining <= 168) return 1;
  return clamp01(1 - (hoursRemaining - 168) / 720);
}

export function scoreOpportunity(
  market: AgentMarket,
  risk: RiskDecision,
  weights: MarketSelectionWeights = DEFAULT_MARKET_SELECTION_WEIGHTS,
  now = new Date()
): MarketSelectionScore {
  const edgeScore = clamp01(risk.diagnostics.selectedEdge / 0.2);
  const confidenceScore = clamp01(risk.intent?.confidence ?? 0);
  const liquidityScore = computeLiquidityScore(market.liquidity);
  const timeRemainingScore = computeTimeRemainingScore(market.expiresAt, now);
  const total =
    edgeScore * weights.edge +
    confidenceScore * weights.confidence +
    liquidityScore * weights.liquidity +
    timeRemainingScore * weights.timeRemaining;

  return {
    total,
    edgeScore,
    confidenceScore,
    liquidityScore,
    timeRemainingScore,
  };
}
