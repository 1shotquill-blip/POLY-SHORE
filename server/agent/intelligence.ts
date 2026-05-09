import { invokeLLM } from "../_core/llm";
import type {
  AgentMarket,
  EnsembleDecision,
  OutcomeSide,
  ProbabilityEstimate,
} from "./types";

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
    this.rules = new Map(rules.map(rule => [rule.marketId, rule]));
  }

  async evaluate(
    market: AgentMarket,
    now = new Date()
  ): Promise<EnsembleDecision | null> {
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

// ─── LLM Intelligence Engine ────────────────────────────────────────────────
// Two-stage pipeline per the design doc:
//   1. Factor extraction  — fast call, identifies what drives the outcome
//   2. Probability estimation — structured JSON with p_est + confidence

interface FactorExtractionResult {
  factors: string[];
  searchQueries: string[];
}

interface ProbabilityEstimationResult {
  probability: number;
  confidence: number;
  rationale: string;
  outcome: OutcomeSide;
}

function formatMarketContext(market: AgentMarket): string {
  const hoursToExpiry = Math.round(
    (market.expiresAt.getTime() - Date.now()) / 3_600_000
  );
  return [
    `Question: ${market.question}`,
    market.resolutionCriteria
      ? `Resolution criteria: ${market.resolutionCriteria}`
      : "",
    `Category: ${market.category ?? "unknown"}`,
    `Market-implied YES probability: ${(market.midpoint * 100).toFixed(1)}%`,
    `Best bid: ${(market.bestBid * 100).toFixed(1)}%  Best ask: ${(market.bestAsk * 100).toFixed(1)}%`,
    `24h volume: $${market.volume24h.toLocaleString()}`,
    `Liquidity: $${market.liquidity.toLocaleString()}`,
    `Hours to expiry: ${hoursToExpiry}`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function extractFactors(
  market: AgentMarket
): Promise<FactorExtractionResult> {
  const result = await invokeLLM({
    messages: [
      {
        role: "system",
        content:
          "You are a prediction-market research assistant. Given a market, identify the 5–8 most important factors that will determine the outcome and produce targeted search queries for each.",
      },
      {
        role: "user",
        content: formatMarketContext(market),
      },
    ],
    outputSchema: {
      name: "factor_extraction",
      schema: {
        type: "object",
        properties: {
          factors: {
            type: "array",
            items: { type: "string" },
            description: "Key factors influencing the outcome",
          },
          searchQueries: {
            type: "array",
            items: { type: "string" },
            description: "Search queries to gather evidence",
          },
        },
        required: ["factors", "searchQueries"],
        additionalProperties: false,
      },
      strict: true,
    },
  });

  const text =
    typeof result.choices[0].message.content === "string"
      ? result.choices[0].message.content
      : result.choices[0].message.content
          .filter((c): c is { type: "text"; text: string } => c.type === "text")
          .map(c => c.text)
          .join("");

  return JSON.parse(text) as FactorExtractionResult;
}

async function estimateProbability(
  market: AgentMarket,
  factors: string[]
): Promise<ProbabilityEstimationResult> {
  const result = await invokeLLM({
    messages: [
      {
        role: "system",
        content: [
          "You are an expert probabilistic forecaster for prediction markets.",
          "Your task: given market context and key factors, estimate the true probability that the YES outcome resolves.",
          "Rules:",
          "- Express probability as a decimal 0–1 (e.g. 0.72, not 72%).",
          "- Confidence is your certainty in the estimate: 0 = total uncertainty, 1 = near-certain.",
          "- Only set confidence ≥ 0.7 if evidence clearly supports a directional view.",
          "- Be calibrated: markets are often efficient; your edge must be well-supported.",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          formatMarketContext(market),
          "",
          "Key factors identified:",
          ...factors.map((f, i) => `${i + 1}. ${f}`),
        ].join("\n"),
      },
    ],
    outputSchema: {
      name: "probability_estimation",
      schema: {
        type: "object",
        properties: {
          outcome: {
            type: "string",
            enum: ["yes", "no"],
            description: "Which outcome the probability refers to",
          },
          probability: {
            type: "number",
            description:
              "Estimated probability of the stated outcome resolving (0–1)",
          },
          confidence: {
            type: "number",
            description: "Confidence in this estimate (0–1)",
          },
          rationale: {
            type: "string",
            description: "One-paragraph explanation citing the key evidence",
          },
        },
        required: ["outcome", "probability", "confidence", "rationale"],
        additionalProperties: false,
      },
      strict: true,
    },
  });

  const text =
    typeof result.choices[0].message.content === "string"
      ? result.choices[0].message.content
      : result.choices[0].message.content
          .filter((c): c is { type: "text"; text: string } => c.type === "text")
          .map(c => c.text)
          .join("");

  return JSON.parse(text) as ProbabilityEstimationResult;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export class LLMIntelligenceEngine implements IntelligenceEngine {
  async evaluate(
    market: AgentMarket,
    now = new Date()
  ): Promise<EnsembleDecision | null> {
    const callStart = Date.now();
    let factors: FactorExtractionResult;
    try {
      factors = await extractFactors(market);
    } catch {
      return null;
    }

    let est: ProbabilityEstimationResult;
    try {
      est = await estimateProbability(market, factors.factors);
    } catch {
      return null;
    }

    const freshnessSeconds = (Date.now() - callStart) / 1000;
    const probability = clamp(est.probability, 0.01, 0.99);
    const confidence = clamp(est.confidence, 0, 1);

    // Normalise: if the LLM picked "no", flip to express as YES probability
    const estimatedProbability =
      est.outcome === "no" ? 1 - probability : probability;

    const estimate: ProbabilityEstimate = {
      source: "llm",
      probability: estimatedProbability,
      confidence,
      evidence: [est.rationale, ...factors.factors],
      freshnessSeconds,
    };

    return {
      marketId: market.marketId,
      outcome: est.outcome,
      estimatedProbability,
      confidence,
      estimates: [estimate],
      modelDisagreement: 0,
      evidenceSummary: [est.rationale],
      generatedAt: now,
    };
  }
}
