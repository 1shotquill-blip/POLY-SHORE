import { invokeLLM } from "./_core/llm";

/**
 * LLM Ensemble: Calls Ollama-compatible LLM with structured prompt to extract probability and confidence.
 * Validates JSON output strictly; invalid output results in null (trade skip).
 */
export interface LLMEnsembleOutput {
  probability: number; // 0-1
  confidence: number; // 0-1
  reasoning?: string;
}

export async function runLLMEnsemble(marketQuestion: string, recentSignals: string): Promise<LLMEnsembleOutput | null> {
  try {
    const prompt = `You are a prediction market analyst. Analyze the following market and recent signals to estimate the probability of a YES outcome.

Market Question: ${marketQuestion}

Recent Signals & Context:
${recentSignals}

Provide your analysis as JSON with the following structure:
{
  "probability": <number between 0 and 1>,
  "confidence": <number between 0 and 1>,
  "reasoning": "brief explanation"
}

Ensure the JSON is valid and contains only these fields.`;

    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: "You are a prediction market analyst. Always respond with valid JSON only.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") {
      console.warn("[LLM] No content in response or content is not a string");
      return null;
    }

    // Extract JSON from response (may be wrapped in markdown code blocks)
    let jsonStr = content;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }

    const parsed = JSON.parse(jsonStr) as LLMEnsembleOutput;

    // Validate output structure
    if (
      typeof parsed.probability !== "number" ||
      typeof parsed.confidence !== "number" ||
      parsed.probability < 0 ||
      parsed.probability > 1 ||
      parsed.confidence < 0 ||
      parsed.confidence > 1
    ) {
      console.warn("[LLM] Invalid probability/confidence values", parsed);
      return null;
    }

    return parsed;
  } catch (error) {
    console.error("[LLM] Error in ensemble:", error);
    return null;
  }
}

/**
 * Sentiment Analysis: Aggregate sentiment scores from recent signals.
 * Returns weighted average sentiment (-1 to 1) and confidence.
 */
export interface SentimentOutput {
  sentiment: number; // -1 (bearish) to 1 (bullish)
  confidence: number; // 0-1
}

export function aggregateSentiment(sentiments: Array<{ score: number; confidence: number }>): SentimentOutput {
  if (sentiments.length === 0) {
    return { sentiment: 0, confidence: 0 };
  }

  const totalWeight = sentiments.reduce((sum, s) => sum + s.confidence, 0);
  if (totalWeight === 0) {
    return { sentiment: 0, confidence: 0 };
  }

  const weightedSentiment = sentiments.reduce((sum, s) => sum + s.score * s.confidence, 0) / totalWeight;
  const avgConfidence = sentiments.reduce((sum, s) => sum + s.confidence, 0) / sentiments.length;

  return {
    sentiment: Math.max(-1, Math.min(1, weightedSentiment)),
    confidence: avgConfidence,
  };
}

/**
 * Bayesian Update: Combine prior probability with LLM and sentiment signals.
 * Uses simple Bayesian framework: posterior proportional to likelihood times prior
 */
export function bayesianUpdate(
  prior: number,
  llmProbability: number,
  llmConfidence: number,
  sentimentScore: number,
  sentimentConfidence: number
): number {
  // Weight LLM more heavily than sentiment
  const llmWeight = 0.7;
  const sentimentWeight = 0.3;

  // Convert sentiment (-1 to 1) to probability (0 to 1)
  const sentimentProbability = (sentimentScore + 1) / 2;

  // Weighted combination
  const estimatedProbability =
    llmProbability * llmWeight * llmConfidence + sentimentProbability * sentimentWeight * sentimentConfidence;

  // Normalize
  const totalWeight = llmWeight * llmConfidence + sentimentWeight * sentimentConfidence;
  const normalized = totalWeight > 0 ? estimatedProbability / totalWeight : prior;

  // Apply prior as regularization (Bayesian smoothing)
  const priorWeight = 0.1;
  const posterior = (normalized * (1 - priorWeight) + prior * priorWeight) / (1 - priorWeight + priorWeight);

  return Math.max(0, Math.min(1, posterior));
}

/**
 * Ensemble Confidence: Combine confidence signals from LLM and sentiment.
 */
export function ensembleConfidence(llmConfidence: number, sentimentConfidence: number): number {
  // Use geometric mean to penalize low confidence from either source
  const geometric = Math.sqrt(llmConfidence * sentimentConfidence);
  return Math.max(0, Math.min(1, geometric));
}

/**
 * Signal Assembly: Combine all intelligence sources into final probability and confidence.
 */
export interface EnsembleOutput {
  finalProbability: number;
  finalConfidence: number;
  llmProbability?: number;
  sentimentScore?: number;
  reasoning?: string;
}

export async function assembleEnsemble(
  marketQuestion: string,
  recentSignals: string,
  sentimentScores: Array<{ score: number; confidence: number }>,
  priorProbability: number = 0.5
): Promise<EnsembleOutput | null> {
  // Run LLM ensemble
  const llmOutput = await runLLMEnsemble(marketQuestion, recentSignals);
  if (!llmOutput) {
    console.warn("[Ensemble] LLM output invalid, skipping trade");
    return null;
  }

  // Aggregate sentiment
  const sentimentOutput = aggregateSentiment(sentimentScores);

  // Bayesian update
  const finalProbability = bayesianUpdate(
    priorProbability,
    llmOutput.probability,
    llmOutput.confidence,
    sentimentOutput.sentiment,
    sentimentOutput.confidence
  );

  // Ensemble confidence
  const finalConfidence = ensembleConfidence(llmOutput.confidence, sentimentOutput.confidence);

  return {
    finalProbability,
    finalConfidence,
    llmProbability: llmOutput.probability,
    sentimentScore: sentimentOutput.sentiment,
    reasoning: llmOutput.reasoning,
  };
}
