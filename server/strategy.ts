/**
 * Strategy Layer: Edge computation, Kelly sizing, and risk management
 */

export interface EdgeInput {
  estimatedProbability: number; // 0-1
  bestBid: number;
  bestAsk: number;
  spread: number;
}

/**
 * Compute edge: difference between estimated probability and market price.
 * For buy: edge = P_est - best_ask
 * For sell: edge = best_bid - P_est
 */
export function computeEdge(input: EdgeInput): { buyEdge: number; sellEdge: number } {
  const { estimatedProbability, bestBid, bestAsk } = input;
  const buyEdge = estimatedProbability - bestAsk;
  const sellEdge = bestBid - estimatedProbability;
  return { buyEdge, sellEdge };
}

/**
 * Fractional Kelly Criterion: f* = (bp - q) / b
 * where p = probability of win, q = probability of loss, b = odds
 * Capped at 0.5 and scaled by kelly fraction config.
 */
export function computeKellySize(
  probability: number,
  oddsAgainst: number,
  kellyFraction: number = 0.25
): number {
  if (probability <= 0 || probability >= 1) return 0;

  const q = 1 - probability;
  const p = probability;
  const b = oddsAgainst;

  // Kelly formula: f* = (bp - q) / b
  const kellyFull = (b * p - q) / b;

  // Apply fractional Kelly (typically 0.25 for safety)
  const kellyFractional = kellyFull * kellyFraction;

  // Cap at 0.5
  const capped = Math.min(0.5, Math.max(0, kellyFractional));

  return capped;
}

/**
 * Risk Management: Compute position size based on Kelly and exposure limits.
 */
export interface RiskCheckInput {
  currentBalance: number;
  currentExposure: number; // percentage (0-100)
  currentDrawdown: number; // percentage (0-100)
  kellySize: number; // fractional Kelly output (0-1)
  maxSingleExposure: number; // percentage (default 5)
  maxTotalExposure: number; // percentage (default 30)
  drawdownLimit: number; // percentage (default 15)
}

export interface RiskCheckOutput {
  isRiskAcceptable: boolean;
  maxPositionSize: number; // in USDC
  reason?: string;
}

export function checkRisk(input: RiskCheckInput): RiskCheckOutput {
  const {
    currentBalance,
    currentExposure,
    currentDrawdown,
    kellySize,
    maxSingleExposure,
    maxTotalExposure,
    drawdownLimit,
  } = input;

  // Check drawdown limit (emergency brake)
  if (currentDrawdown >= drawdownLimit) {
    return {
      isRiskAcceptable: false,
      maxPositionSize: 0,
      reason: `Drawdown ${currentDrawdown.toFixed(2)}% exceeds limit ${drawdownLimit}%`,
    };
  }

  // Check total exposure
  const newTotalExposure = currentExposure + kellySize * 100;
  if (newTotalExposure > maxTotalExposure) {
    return {
      isRiskAcceptable: false,
      maxPositionSize: 0,
      reason: `Total exposure ${newTotalExposure.toFixed(2)}% exceeds limit ${maxTotalExposure}%`,
    };
  }

  // Compute max position size from single-market exposure limit
  const maxSingleSize = (currentBalance * maxSingleExposure) / 100;

  // Compute Kelly-based position size
  const kellySize_USDC = currentBalance * kellySize;

  // Take the minimum of Kelly and single-market limits
  const maxPositionSize = Math.min(kellySize_USDC, maxSingleSize);

  return {
    isRiskAcceptable: true,
    maxPositionSize,
  };
}

/**
 * Drawdown Monitor: Track peak balance and compute current drawdown.
 */
export function computeDrawdown(currentBalance: number, peakBalance: number): number {
  if (peakBalance === 0) return 0;
  const drawdown = ((peakBalance - currentBalance) / peakBalance) * 100;
  return Math.max(0, drawdown);
}

/**
 * Emergency Brake: Triggered when drawdown >= limit.
 */
export interface EmergencyBrakeInput {
  currentDrawdown: number;
  drawdownLimit: number;
}

export function shouldTriggerEmergencyBrake(input: EmergencyBrakeInput): boolean {
  return input.currentDrawdown >= input.drawdownLimit;
}
