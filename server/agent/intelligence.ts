import type { AgentMarket, EnsembleDecision, ProbabilityEstimate } from "./types";

export interface IntelligenceEngine {
  evaluate(market: AgentMarket, now?: Date): Promise<EnsembleDecision | null>;
}

export interface StaticProbabilityRule {
  marketId: string;
  probability: number;
  confidence: number;
  evidence: string[];
}

export class RuleBasedIntelligenceEngine implements IntelligenceEngine {
  private readonly rules: Map<string, StaticProbabilityRule>;

  constructor(rules: StaticProbabilityRule[] = []) {
    this.rules = new Map(rules.map((rule) => [rule.marketId, rule]));
  }

  async evaluate(market: AgentMarket, now = new Date()): Promise<EnsembleDecision | null> {
    const rule = this.rules.get(market.marketId);
    if (!rule) return null;

    const estimates: ProbabilityEstimate[] = [
      {
        source: "rule",
        probability: rule.probability,
        confidence: rule.confidence,
        evidence: rule.evidence,
        freshnessSeconds: 0,
      },
    ];

    return {
      marketId: market.marketId,
      outcome: "yes",
      estimatedProbability: rule.probability,
      confidence: rule.confidence,
      estimates,
      modelDisagreement: 0,
      evidenceSummary: rule.evidence,
      generatedAt: now,
    };
  }
}

export class NoopIntelligenceEngine implements IntelligenceEngine {
  async evaluate(): Promise<EnsembleDecision | null> {
    return null;
  }
}
