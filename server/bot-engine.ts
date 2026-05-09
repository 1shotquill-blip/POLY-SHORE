import {
  getBotConfig,
  updateBotConfig,
  insertEquitySnapshot,
  getLatestEquitySnapshot,
  insertSignal,
  getRecentSignals,
  getOpenOrders,
} from "./db";
import { ingestMarketData, getMarketData, isOrderbookStale } from "./ingestion";
import { assembleEnsemble } from "./intelligence";
import {
  computeEdge,
  computeKellySize,
  checkRisk,
  computeDrawdown,
  shouldTriggerEmergencyBrake,
} from "./strategy";
import { placeGTCLimitOrder, cancelOrder, isOrderExpired } from "./execution";
import { notifyOwner } from "./_core/notification";
import type { OrderbookSnapshot } from "./ingestion";

/**
 * Bot Engine: Main polling loop orchestrating the full trading cycle
 */

export interface BotEngineConfig {
  pollingIntervalSeconds: number;
  minVolume24h: number;
  maxSpread: number;
  edgeThreshold: number;
  kellyFraction: number;
  maxSingleExposure: number;
  maxTotalExposure: number;
  drawdownLimit: number;
  minConfidence: number;
  orderTimeoutSeconds: number;
}

export class BotEngine {
  private isRunning = false;
  private isPaused = false;
  private emergencyBrakeTriggered = false;
  private pollingInterval: NodeJS.Timeout | null = null;
  private currentBalance = 10000; // Starting balance in USDC
  private peakBalance = 10000;
  private currentExposure = 0; // percentage
  private config: BotEngineConfig;
  private executionMode: "paper" | "live" = "paper";

  constructor(config: BotEngineConfig) {
    this.config = config;
  }

  /**
   * Start the bot
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log("[Bot] Already running");
      return;
    }

    this.isRunning = true;
    this.isPaused = false;
    this.emergencyBrakeTriggered = false;

    console.log(`[Bot] Starting in ${this.executionMode} mode`);
    await updateBotConfig({
      isRunning: 1,
      isPaused: 0,
      emergencyBrakeTriggered: 0,
    });

    // Start polling loop
    this.pollingInterval = setInterval(() => {
      this.tick().catch(error => console.error("[Bot] Tick error:", error));
    }, this.config.pollingIntervalSeconds * 1000);

    // Run first tick immediately
    await this.tick();
  }

  /**
   * Stop the bot gracefully
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      console.log("[Bot] Not running");
      return;
    }

    this.isRunning = false;
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }

    // Cancel all open orders
    const openOrders = await getOpenOrders();
    for (const order of openOrders) {
      await cancelOrder(order.nonce, this.executionMode);
    }

    console.log("[Bot] Stopped gracefully");
    await updateBotConfig({ isRunning: 0 });
  }

  /**
   * Pause the bot (can be resumed)
   */
  async pause(): Promise<void> {
    this.isPaused = true;
    console.log("[Bot] Paused");
    await updateBotConfig({ isPaused: 1 });
  }

  /**
   * Resume the bot
   */
  async resume(): Promise<void> {
    this.isPaused = false;
    this.emergencyBrakeTriggered = false;
    console.log("[Bot] Resumed");
    await updateBotConfig({ isPaused: 0, emergencyBrakeTriggered: 0 });
  }

  /**
   * Main polling tick: orchestrates the full trading cycle
   */
  private async tick(): Promise<void> {
    if (this.isPaused || this.emergencyBrakeTriggered) {
      console.log("[Bot] Tick skipped (paused or emergency brake)");
      return;
    }

    try {
      // 1. Fetch eligible markets
      const markets = await ingestMarketData(
        this.config.minVolume24h,
        this.config.maxSpread
      );
      console.log(`[Bot] Fetched ${markets.length} eligible markets`);

      // 2. For each market, run the decision pipeline
      for (const market of markets.slice(0, 10)) {
        // Limit to 10 markets per tick
        await this.evaluateMarket(market.id);
      }

      // 3. Check order timeouts and re-evaluate
      await this.checkOrderTimeouts();

      // 4. Update equity snapshot
      await this.updateEquitySnapshot();
    } catch (error) {
      console.error("[Bot] Tick failed:", error);
    }
  }

  /**
   * Evaluate a single market and place order if conditions met
   */
  private async evaluateMarket(marketId: string): Promise<void> {
    try {
      const market = await getMarketData(marketId);
      if (!market) {
        console.log(`[Bot] Market ${marketId} not found in cache`);
        return;
      }

      // Get recent signals
      const signals = await getRecentSignals(marketId, 5);
      const signalText = signals
        .map(s => `${s.source}: ${s.content}`)
        .join("\n");

      // Assemble ensemble probability
      const ensemble = await assembleEnsemble(
        market.question,
        signalText,
        [],
        0.5
      );
      if (!ensemble) {
        console.log(`[Bot] Invalid ensemble output for ${marketId}, skipping`);
        return;
      }

      // Compute edge
      const { buyEdge, sellEdge } = computeEdge({
        estimatedProbability: ensemble.finalProbability,
        bestBid: market.bestBid,
        bestAsk: market.bestAsk,
        spread: market.bestAsk - market.bestBid,
      });

      // Check edge threshold
      const maxEdge = Math.max(buyEdge, sellEdge);
      if (maxEdge < this.config.edgeThreshold) {
        console.log(
          `[Bot] Edge ${maxEdge.toFixed(4)} below threshold for ${marketId}`
        );
        return;
      }

      // Check confidence
      if (ensemble.finalConfidence < this.config.minConfidence) {
        console.log(
          `[Bot] Confidence ${ensemble.finalConfidence.toFixed(2)} below minimum for ${marketId}`
        );
        return;
      }

      // Compute Kelly size
      const kellySize = computeKellySize(
        ensemble.finalProbability,
        1,
        this.config.kellyFraction
      );

      // Risk check
      const drawdown = computeDrawdown(this.currentBalance, this.peakBalance);
      const riskCheck = checkRisk({
        currentBalance: this.currentBalance,
        currentExposure: this.currentExposure,
        currentDrawdown: drawdown,
        kellySize,
        maxSingleExposure: this.config.maxSingleExposure,
        maxTotalExposure: this.config.maxTotalExposure,
        drawdownLimit: this.config.drawdownLimit,
      });

      if (!riskCheck.isRiskAcceptable) {
        console.log(`[Bot] Risk check failed: ${riskCheck.reason}`);

        // Check if emergency brake triggered
        if (
          shouldTriggerEmergencyBrake({
            currentDrawdown: drawdown,
            drawdownLimit: this.config.drawdownLimit,
          })
        ) {
          await this.triggerEmergencyBrake();
        }
        return;
      }

      // Determine side and place order
      const side = buyEdge > sellEdge ? "buy" : "sell";
      const orderResult = await placeGTCLimitOrder(
        {
          marketId,
          tokenId: market.id,
          side,
          price: side === "buy" ? market.bestAsk - 0.01 : market.bestBid + 0.01,
          size: riskCheck.maxPositionSize,
          edgeAtPlacement: maxEdge,
          confidenceAtPlacement: ensemble.finalConfidence,
        },
        this.executionMode
      );

      if (orderResult.status === "pending") {
        console.log(`[Bot] Order placed: ${orderResult.nonce}`);
        this.currentExposure +=
          (riskCheck.maxPositionSize / this.currentBalance) * 100;
      } else {
        console.log(`[Bot] Order failed: ${orderResult.reason}`);
      }
    } catch (error) {
      console.error(`[Bot] Error evaluating market ${marketId}:`, error);
    }
  }

  /**
   * Check for expired orders and re-evaluate
   */
  private async checkOrderTimeouts(): Promise<void> {
    const openOrders = await getOpenOrders();
    for (const order of openOrders) {
      if (
        isOrderExpired({
          nonce: order.nonce,
          placedAt: order.placedAt,
          timeoutSeconds: this.config.orderTimeoutSeconds,
        })
      ) {
        console.log(`[Bot] Order ${order.nonce} expired, cancelling`);
        await cancelOrder(order.nonce, this.executionMode);
      }
    }
  }

  /**
   * Update equity snapshot
   */
  private async updateEquitySnapshot(): Promise<void> {
    const drawdown = computeDrawdown(this.currentBalance, this.peakBalance);
    await insertEquitySnapshot({
      balance: this.currentBalance.toString(),
      peakBalance: this.peakBalance.toString(),
      drawdown: drawdown.toString(),
      totalExposure: this.currentExposure.toString(),
    });
  }

  /**
   * Trigger emergency brake
   */
  private async triggerEmergencyBrake(): Promise<void> {
    this.emergencyBrakeTriggered = true;
    console.log("[Bot] EMERGENCY BRAKE TRIGGERED");

    // Cancel all open orders
    const openOrders = await getOpenOrders();
    for (const order of openOrders) {
      await cancelOrder(order.nonce, this.executionMode);
    }

    // Update config
    await updateBotConfig({ emergencyBrakeTriggered: 1 });

    try {
      const sent = await notifyOwner({
        title: "Polymarket bot emergency brake triggered",
        content: `The bot stopped trading after drawdown reached ${computeDrawdown(this.currentBalance, this.peakBalance).toFixed(2)}%. Open orders were cancelled in ${this.executionMode} mode.`,
      });
      console.log(
        `[Bot] Owner notification ${sent ? "accepted" : "not accepted by notification service"}`
      );
    } catch (error) {
      console.warn("[Bot] Owner notification unavailable:", error);
    }
  }

  /**
   * Set execution mode
   */
  setExecutionMode(mode: "paper" | "live"): void {
    this.executionMode = mode;
    console.log(`[Bot] Execution mode set to ${mode}`);
  }

  /**
   * Get current status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      emergencyBrakeTriggered: this.emergencyBrakeTriggered,
      executionMode: this.executionMode,
      currentBalance: this.currentBalance,
      peakBalance: this.peakBalance,
      currentExposure: this.currentExposure,
      drawdown: computeDrawdown(this.currentBalance, this.peakBalance),
    };
  }
}
