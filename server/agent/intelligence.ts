import { invokeLLM } from "../_core/llm";
import {
  buildCategoryCalibrationContext,
  calibrateConfidence,
  calibrateProbability,
  describeCalibrationContext,
  type CategoryCalibrationContext,
} from "../intelligence/calibration";
import {
  ingestNewsForQueries,
  type NewsSignal,
} from "../intelligence/news-ingestion";
import { searchTweets } from "../intelligence/x-ingestion";
import { getClobReferencePrice } from "./book-pricing";
import type {
  AgentMarket,
  EnsembleDecision,
  OutcomeSide,
  ProbabilityEstimate,
  SocialSignal,
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
  const referencePrice = getClobReferencePrice(market);
  const referencePriceLabel = Number.isFinite(referencePrice)
    ? (referencePrice * 100).toFixed(1)
    : "n/a";
  return [
    `Question: ${market.question}`,
    market.resolutionCriteria
      ? `Resolution criteria: ${market.resolutionCriteria}`
      : "",
    `Category: ${market.category ?? "unknown"}`,
    `CLOB reference YES probability: ${referencePriceLabel}%`,
    `Best bid: ${(market.bestBid * 100).toFixed(1)}%  Best ask: ${(market.bestAsk * 100).toFixed(1)}%`,
    `24h volume: $${market.volume24h.toLocaleString()}`,
    `Liquidity: $${market.liquidity.toLocaleString()}`,
    `Hours to expiry: ${hoursToExpiry}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatNewsContext(news: NewsSignal[]): string {
  if (news.length === 0) {
    return "News context: unavailable or no high-signal results.";
  }

  return [
    `News context (${news.length} items):`,
    ...news.slice(0, 12).map(item => {
      const sentiment = item.sentiment.toFixed(2);
      return `- [${item.source}] ${item.timestamp.toISOString()} sentiment=${sentiment} ${item.content}`;
    }),
  ].join("\n");
}

function formatSocialContext(socialSignals: SocialSignal[]): string {
  if (socialSignals.length === 0) {
    return "Recent social signal: unavailable or no qualifying tweets.";
  }

  return [
    `Recent social signal (${socialSignals.length} tweets):`,
    ...socialSignals.slice(0, 20).map(tweet =>
      [
        `- @${tweet.author_username} ${tweet.created_at}`,
        `likes=${tweet.metrics.likes} retweets=${tweet.metrics.retweets} replies=${tweet.metrics.replies}`,
        typeof tweet.sentiment_score === "number"
          ? `sentiment=${tweet.sentiment_score.toFixed(2)}`
          : "sentiment=unavailable",
        tweet.text,
      ].join(" | ")
    ),
  ].join("\n");
}

async function extractFactors(
  market: AgentMarket
): Promise<FactorExtractionResult> {
  const result = await invokeLLM({
    messages: [
      {
        role: "system",
        content: [
          "You are a prediction-market research assistant. Given a market, identify the 5–8 most important factors that will determine the outcome and produce targeted search queries for each.",
          "The searchQueries array should contain concise market-keyword queries suitable for X/Twitter and news search APIs.",
        ].join("\n"),
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
  factors: string[],
  news: NewsSignal[],
  socialSignals: SocialSignal[],
  calibration?: CategoryCalibrationContext
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
          "- Weigh news context only when it is recent, specific, and market-relevant.",
          "- Weigh social context only when tweets are recent, engaged, and directly relevant.",
          calibration
            ? `- Bayesian anchor: ${describeCalibrationContext(calibration)}`
            : "- Bayesian anchor: unavailable",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          formatMarketContext(market),
          "",
          "Key factors identified:",
          ...factors.map((f, i) => `${i + 1}. ${f}`),
          "",
          formatNewsContext(news),
          "",
          formatSocialContext(socialSignals),
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

async function collectSocialSignals(
  searchQueries: string[],
  lookbackHours = 6
): Promise<SocialSignal[]> {
  const uniqueQueries = Array.from(
    new Set(searchQueries.map(query => query.trim()).filter(Boolean))
  ).slice(0, 8);
  const batches = await Promise.all(
    uniqueQueries.map(query => searchTweets(query, lookbackHours))
  );
  const byId = new Map<string, SocialSignal>();
  for (const tweet of batches.flat()) byId.set(tweet.id, tweet);
  return Array.from(byId.values())
    .sort((a, b) => {
      const engagementA =
        a.metrics.likes + a.metrics.retweets * 2 + a.metrics.replies;
      const engagementB =
        b.metrics.likes + b.metrics.retweets * 2 + b.metrics.replies;
      return engagementB - engagementA;
    })
    .slice(0, 20);
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

    let news: NewsSignal[] = [];
    try {
      news = await ingestNewsForQueries(factors.searchQueries, {
        now,
      });
    } catch {
      console.warn(
        `[News] News ingestion failed for market ${market.marketId}; continuing with LLM-only reasoning`
      );
      news = [];
    }

    let socialSignals: SocialSignal[] = [];
    try {
      socialSignals = await collectSocialSignals(factors.searchQueries);
    } catch {
      console.warn(
        `[XIngestion] Social ingestion failed for market ${market.marketId}; continuing with LLM/news reasoning`
      );
      socialSignals = [];
    }

    let calibration: CategoryCalibrationContext | undefined;
    try {
      calibration = await buildCategoryCalibrationContext(market.category);
    } catch {
      calibration = undefined;
    }

    let est: ProbabilityEstimationResult;
    try {
      est = await estimateProbability(
        market,
        factors.factors,
        news,
        socialSignals,
        calibration
      );
    } catch {
      return null;
    }

    const freshnessSeconds = (Date.now() - callStart) / 1000;
    const probability = calibration
      ? calibrateProbability(clamp(est.probability, 0.01, 0.99), calibration)
      : clamp(est.probability, 0.01, 0.99);
    const confidence = calibration
      ? calibrateConfidence(clamp(est.confidence, 0, 1), calibration)
      : clamp(est.confidence, 0, 1);

    // Normalise: if the LLM picked "no", flip to express as YES probability
    const estimatedProbability =
      est.outcome === "no" ? 1 - probability : probability;

    const estimate: ProbabilityEstimate = {
      source: "llm",
      probability: estimatedProbability,
      confidence,
      evidence: [
        est.rationale,
        ...factors.factors,
        ...news.map(item => item.content),
        ...socialSignals.map(
          tweet =>
            `Recent social signal @${tweet.author_username}: ${tweet.text}`
        ),
      ],
      freshnessSeconds,
      socialSignals,
    };

    return {
      marketId: market.marketId,
      outcome: est.outcome,
      estimatedProbability,
      confidence,
      estimates: [estimate],
      modelDisagreement: 0,
      evidenceSummary: [
        est.rationale,
        socialSignals.length > 0
          ? `Recent social signal: ${socialSignals.length} tweets factored into forecast`
          : "Recent social signal unavailable or empty",
      ],
      generatedAt: now,
    };
  }
}
