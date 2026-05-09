import {
  updateBotConfig,
  insertEquitySnapshot,
  getLatestEquitySnapshot,
  getOpenOrders,
} from "./db";
import { updateOrderSyncState } from "./db";
import { notifyOwner } from "./_core/notification";
import { ENV } from "./_core/env";
import { AgentOrchestrator } from "./agent/orchestrator";
import { LLMIntelligenceEngine } from "./agent/intelligence";
import { ProductionDeepEdgeGate } from "./agent/deep-edge-gate";
import { ClobPortfolioProvider } from "./agent/portfolio-provider";
import { scanTradableMarkets } from "./agent/market-scanner";
import { createExecutionAdapter } from "./exchange/polymarket/index";
import { DEFAULT_RISK_LIMITS } from "./agent/risk-manager";
import type { ExecutionAdapter } from "./agent/execution-adapter";
import type { RiskLimits } from "./agent/types";

export interface BotEngineConfig {
  pollingIntervalSeconds: number;
  lifecyclePollingIntervalSeconds: number;
  minVolume24h: number;
  minLiquidity: number;
  maxSpread: number;
  orderTtlMs: number;
  maxMarketsPerTick: number;
  maxOrdersPerTick: number;
  riskLimits?: Partial<RiskLimits>;
}

const DEFAULT_CONFIG: BotEngineConfig = {
  pollingIntervalSeconds: 15,
  lifecyclePollingIntervalSeconds: Math.round(ENV.pollIntervalMs / 1_000),
  minVolume24h: 5_000,
  minLiquidity: 1_000,
  maxSpread: 0.05,
  orderTtlMs: ENV.orderTtlMs,
  maxMarketsPerTick: 20,
  maxOrdersPerTick: 1,
};

export class BotEngine {
  private isRunning = false;
  private isPaused = false;
  private emergencyBrakeTriggered = false;
  private tickInterval: NodeJS.Timeout | null = null;
  private lifecycleInterval: NodeJS.Timeout | null = null;
  private readonly config: BotEngineConfig;
  private orchestrator: AgentOrchestrator | null = null;
  private executionAdapter: ExecutionAdapter | null = null;

  constructor(config: Partial<BotEngineConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log("[Bot] Already running");
      return;
    }

    this.executionAdapter = await createExecutionAdapter();

    const portfolioProvider = new ClobPortfolioProvider();
    const intelligence = new LLMIntelligenceEngine();
    const deepEdgeGate = new ProductionDeepEdgeGate();

    this.orchestrator = new AgentOrchestrator({
      marketProvider: {
        scan: async now =>
          (
            await scanTradableMarkets(
              {
                limit: this.config.maxMarketsPerTick * 3,
                minVolume24h: this.config.minVolume24h,
                minLiquidity: this.config.minLiquidity,
              },
              { ...DEFAULT_RISK_LIMITS, maxSpread: this.config.maxSpread },
              now
            )
          ).tradable.slice(0, this.config.maxMarketsPerTick),
      },
      portfolioProvider,
      intelligence,
      execution: this.executionAdapter,
      deepEdgeGate,
      maxOrdersPerTick: this.config.maxOrdersPerTick,
      riskLimits: {
        ...DEFAULT_RISK_LIMITS,
        maxOrderSizeUsd: ENV.maxPositionUsd,
        maxDrawdownPct: ENV.maxDrawdownPct,
        ...this.config.riskLimits,
      },
    });

    this.isRunning = true;
    this.isPaused = false;
    this.emergencyBrakeTriggered = false;

    const mode =
      process.env.EXECUTION_MODE ?? (ENV.liveTradingEnabled ? "live" : "paper");
    console.log(`[Bot] Starting in ${mode} mode`);
    await updateBotConfig({
      isRunning: 1,
      isPaused: 0,
      emergencyBrakeTriggered: 0,
    });

    this.tickInterval = setInterval(() => {
      this.tick().catch(err => console.error("[Bot] Tick error:", err));
    }, this.config.pollingIntervalSeconds * 1_000);

    this.lifecycleInterval = setInterval(() => {
      this.pollOrderLifecycle().catch(err =>
        console.error("[Bot] Lifecycle poll error:", err)
      );
    }, this.config.lifecyclePollingIntervalSeconds * 1_000);

    await this.tick();
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    this.isRunning = false;
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    if (this.lifecycleInterval) {
      clearInterval(this.lifecycleInterval);
      this.lifecycleInterval = null;
    }

    await this.cancelAllOpenOrders("stop");
    await updateBotConfig({ isRunning: 0 });
    console.log("[Bot] Stopped");
  }

  async pause(): Promise<void> {
    this.isPaused = true;
    await updateBotConfig({ isPaused: 1 });
    console.log("[Bot] Paused");
  }

  async resume(): Promise<void> {
    this.isPaused = false;
    this.emergencyBrakeTriggered = false;
    await updateBotConfig({ isPaused: 0, emergencyBrakeTriggered: 0 });
    console.log("[Bot] Resumed");
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      emergencyBrakeTriggered: this.emergencyBrakeTriggered,
      executionMode:
        process.env.EXECUTION_MODE ??
        (ENV.liveTradingEnabled ? "live" : "paper"),
    };
  }

  // ─── Main trading tick ────────────────────────────────────────────────────

  private async tick(): Promise<void> {
    if (this.isPaused || this.emergencyBrakeTriggered || !this.orchestrator)
      return;

    try {
      const result = await this.orchestrator.tick();
      console.log(
        `[Bot] Tick: scanned=${result.scannedMarkets} submitted=${result.submittedOrders} skipped=${result.skippedMarkets}`
      );
      await this.updateEquitySnapshot();
    } catch (err) {
      console.error("[Bot] Tick failed:", err);
    }
  }

  // ─── GAP 5: Order lifecycle polling ─────────────────────────────────────

  private async pollOrderLifecycle(): Promise<void> {
    if (!this.executionAdapter) return;

    const openOrders = await getOpenOrders();
    const now = new Date();

    for (const order of openOrders) {
      const age = now.getTime() - new Date(order.placedAt).getTime();
      const stale = age > this.config.orderTtlMs;

      if (stale && order.nonce) {
        try {
          await this.executionAdapter.cancel(order.nonce, now);
          await updateOrderSyncState(order.nonce, {
            status: "cancelled",
            lifecycleState: "CANCEL_CONFIRMED",
          });
          console.log(
            `[Bot] Cancelled stale order ${order.nonce} (age ${Math.round(age / 1000)}s)`
          );
        } catch (err) {
          console.warn(`[Bot] Failed to cancel order ${order.nonce}:`, err);
        }
        continue;
      }

      if (order.nonce) {
        try {
          const dummyMarket = {
            marketId: order.marketId,
            yesTokenId: order.tokenId,
            noTokenId: "",
            question: "",
            bestBid: Number(order.price),
            bestAsk: Number(order.price),
            spread: 0,
            midpoint: Number(order.price),
            volume24h: 0,
            liquidity: 0,
            expiresAt: new Date(Date.now() + 86_400_000),
            orderbookUpdatedAt: now,
          } as import("./agent/types").AgentMarket;

          const update = await this.executionAdapter.sync(
            order.nonce,
            dummyMarket,
            now
          );

          const newStatus =
            update.status === "filled"
              ? "filled"
              : update.status === "partially_filled"
                ? "partially_filled"
                : update.status === "cancelled" || update.status === "expired"
                  ? update.status
                  : undefined;

          if (newStatus && newStatus !== order.status) {
            await updateOrderSyncState(order.nonce, { status: newStatus });
            console.log(`[Bot] Order ${order.nonce} → ${newStatus}`);

            if (newStatus === "filled" || newStatus === "cancelled") {
              await this.updateEquitySnapshot();
            }
          }
        } catch (err) {
          console.warn(`[Bot] Sync failed for order ${order.nonce}:`, err);
        }
      }
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private async cancelAllOpenOrders(reason: string): Promise<void> {
    if (!this.executionAdapter) return;
    const openOrders = await getOpenOrders();
    for (const order of openOrders) {
      try {
        await this.executionAdapter.cancel(order.nonce, new Date());
        await updateOrderSyncState(order.nonce, {
          status: "cancelled",
          lifecycleState: "CANCEL_CONFIRMED",
        });
      } catch (err) {
        console.warn(
          `[Bot] Cancel failed (${reason}) for ${order.nonce}:`,
          err
        );
      }
    }
  }

  private async triggerEmergencyBrake(drawdownPct: number): Promise<void> {
    this.emergencyBrakeTriggered = true;
    console.error(
      "[Bot] EMERGENCY BRAKE — drawdown",
      drawdownPct.toFixed(2),
      "%"
    );

    // Gap 9: disarm killswitch, which cancels all open GTC orders.
    const { PolymarketAdapter } = await import("./exchange/polymarket/index");
    if (this.executionAdapter instanceof PolymarketAdapter) {
      await this.executionAdapter.killswitch.disarm(() =>
        this.cancelAllOpenOrders("killswitch disarm")
      );
    } else {
      await this.cancelAllOpenOrders("emergency brake");
    }

    await updateBotConfig({ emergencyBrakeTriggered: 1 });
    try {
      await notifyOwner({
        title: "Polymarket bot emergency brake triggered",
        content: `Bot paused after drawdown reached ${drawdownPct.toFixed(2)}%. All open orders cancelled.`,
      });
    } catch {
      // notification not critical
    }
  }

  private async updateEquitySnapshot(): Promise<void> {
    const latest = await getLatestEquitySnapshot();
    const balance = latest ? Number(latest.balance) : 0;
    const peakBalance = latest ? Number(latest.peakBalance) : balance;
    const drawdown =
      peakBalance > 0 ? ((peakBalance - balance) / peakBalance) * 100 : 0;

    await insertEquitySnapshot({
      balance: balance.toString(),
      peakBalance: Math.max(balance, peakBalance).toString(),
      drawdown: drawdown.toString(),
      totalExposure: "0",
    });

    const maxDrawdown =
      this.config.riskLimits?.maxDrawdownPct ?? ENV.maxDrawdownPct;
    if (drawdown >= maxDrawdown && !this.emergencyBrakeTriggered) {
      await this.triggerEmergencyBrake(drawdown);
    }
  }
}
