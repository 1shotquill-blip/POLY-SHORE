import { describe, it, expect } from "vitest";
import { computeEdge, computeKellySize, checkRisk, computeDrawdown, shouldTriggerEmergencyBrake } from "./strategy";
import { aggregateSentiment, bayesianUpdate, ensembleConfidence } from "./intelligence";
import { generateNonce } from "./execution";

describe("Strategy Module", () => {
  describe("computeEdge", () => {
    it("should compute positive buy edge when P_est > best_ask", () => {
      const { buyEdge } = computeEdge({
        estimatedProbability: 0.7,
        bestBid: 0.6,
        bestAsk: 0.65,
        spread: 0.05,
      });
      expect(buyEdge).toBeCloseTo(0.05, 5);
    });

    it("should compute positive sell edge when best_bid > P_est", () => {
      const { sellEdge } = computeEdge({
        estimatedProbability: 0.3,
        bestBid: 0.35,
        bestAsk: 0.4,
        spread: 0.05,
      });
      expect(sellEdge).toBeCloseTo(0.05, 5);
    });
  });

  describe("computeKellySize", () => {
    it("should return 0 for probability at boundaries", () => {
      expect(computeKellySize(0, 1, 0.25)).toBe(0);
      expect(computeKellySize(1, 1, 0.25)).toBe(0);
    });

    it("should cap at 0.5", () => {
      const size = computeKellySize(0.9, 1, 1.0); // Full Kelly
      expect(size).toBeLessThanOrEqual(0.5);
    });

    it("should apply fractional Kelly", () => {
      const fullKelly = computeKellySize(0.6, 1, 1.0);
      const fractionalKelly = computeKellySize(0.6, 1, 0.25);
      expect(fractionalKelly).toBeLessThan(fullKelly);
    });
  });

  describe("checkRisk", () => {
    it("should reject when drawdown exceeds limit", () => {
      const result = checkRisk({
        currentBalance: 10000,
        currentExposure: 10,
        currentDrawdown: 20,
        kellySize: 0.1,
        maxSingleExposure: 5,
        maxTotalExposure: 30,
        drawdownLimit: 15,
      });
      expect(result.isRiskAcceptable).toBe(false);
    });

    it("should reject when total exposure would exceed limit", () => {
      const result = checkRisk({
        currentBalance: 10000,
        currentExposure: 25,
        currentDrawdown: 5,
        kellySize: 0.1,
        maxSingleExposure: 5,
        maxTotalExposure: 30,
        drawdownLimit: 15,
      });
      expect(result.isRiskAcceptable).toBe(false);
    });

    it("should accept when within all limits", () => {
      const result = checkRisk({
        currentBalance: 10000,
        currentExposure: 10,
        currentDrawdown: 5,
        kellySize: 0.1,
        maxSingleExposure: 5,
        maxTotalExposure: 30,
        drawdownLimit: 15,
      });
      expect(result.isRiskAcceptable).toBe(true);
      expect(result.maxPositionSize).toBeGreaterThan(0);
    });
  });

  describe("computeDrawdown", () => {
    it("should compute 0 drawdown when balance equals peak", () => {
      expect(computeDrawdown(10000, 10000)).toBe(0);
    });

    it("should compute 50% drawdown when balance is half peak", () => {
      expect(computeDrawdown(5000, 10000)).toBe(50);
    });

    it("should never return negative drawdown", () => {
      expect(computeDrawdown(15000, 10000)).toBe(0);
    });
  });

  describe("shouldTriggerEmergencyBrake", () => {
    it("should trigger when drawdown >= limit", () => {
      expect(shouldTriggerEmergencyBrake({ currentDrawdown: 15, drawdownLimit: 15 })).toBe(true);
      expect(shouldTriggerEmergencyBrake({ currentDrawdown: 20, drawdownLimit: 15 })).toBe(true);
    });

    it("should not trigger when drawdown < limit", () => {
      expect(shouldTriggerEmergencyBrake({ currentDrawdown: 14, drawdownLimit: 15 })).toBe(false);
    });
  });
});

describe("Intelligence Module", () => {
  describe("aggregateSentiment", () => {
    it("should return neutral sentiment for empty array", () => {
      const result = aggregateSentiment([]);
      expect(result.sentiment).toBe(0);
      expect(result.confidence).toBe(0);
    });

    it("should compute weighted average sentiment", () => {
      const result = aggregateSentiment([
        { score: 1, confidence: 0.8 },
        { score: -1, confidence: 0.6 },
      ]);
      expect(result.sentiment).toBeGreaterThan(-1);
      expect(result.sentiment).toBeLessThan(1);
    });

    it("should clamp sentiment to [-1, 1]", () => {
      const result = aggregateSentiment([
        { score: 2, confidence: 1 },
        { score: -2, confidence: 1 },
      ]);
      expect(result.sentiment).toBeGreaterThanOrEqual(-1);
      expect(result.sentiment).toBeLessThanOrEqual(1);
    });
  });

  describe("bayesianUpdate", () => {
    it("should produce probability between 0 and 1", () => {
      const result = bayesianUpdate(0.5, 0.7, 0.8, 0.5, 0.6);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(1);
    });

    it("should weight LLM more heavily than sentiment", () => {
      // High LLM, low sentiment should produce higher probability
      const result1 = bayesianUpdate(0.5, 0.9, 0.9, -0.9, 0.9);
      // Low LLM, high sentiment should produce lower probability
      const result2 = bayesianUpdate(0.5, 0.1, 0.9, 0.9, 0.9);
      expect(result1).toBeGreaterThan(result2);
    });
  });

  describe("ensembleConfidence", () => {
    it("should return 0 when either confidence is 0", () => {
      expect(ensembleConfidence(0, 0.8)).toBe(0);
      expect(ensembleConfidence(0.8, 0)).toBe(0);
    });

    it("should use geometric mean", () => {
      const result = ensembleConfidence(0.64, 0.64);
      expect(result).toBe(0.64);
    });

    it("should penalize low confidence from either source", () => {
      const balanced = ensembleConfidence(0.8, 0.8);
      const unbalanced = ensembleConfidence(0.9, 0.1);
      expect(unbalanced).toBeLessThan(balanced);
    });
  });
});

describe("Execution Module", () => {
  describe("generateNonce", () => {
    it("should generate unique nonces", () => {
      const nonce1 = generateNonce();
      const nonce2 = generateNonce();
      expect(nonce1).not.toBe(nonce2);
    });

    it("should include timestamp", () => {
      const nonce = generateNonce();
      expect(nonce).toMatch(/^\d+/);
    });
  });
});
