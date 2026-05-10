import { nanoid } from "nanoid";
import { ENV } from "../../_core/env";
import type {
  ExecutionAdapter,
  OrderLifecycleUpdate,
} from "../../agent/execution-adapter";
import type {
  AgentMarket,
  ExecutionReceipt,
  TradeIntent,
} from "../../agent/types";
import { PaperExecutionAdapter } from "../../agent/paper-execution";
import { KalshiClient } from "./client";
import {
  cancelKalshiOrder,
  getKalshiOrderStatus,
  placeKalshiLimitOrder,
} from "./orders";
import { listKalshiMarkets, getKalshiMarket } from "./markets";
import { KalshiConfigurationError } from "./auth";

export class KalshiKillswitch {
  private disarmed = false;

  constructor(private readonly armed = ENV.kalshiKillswitchArmed) {}

  async disarm(): Promise<void> {
    this.disarmed = true;
    console.error("[KalshiKillswitch] DISARMED - blocking all new orders");
  }

  isArmed(): boolean {
    return this.armed && !this.disarmed;
  }

  assertCanSubmit(): void {
    if (!this.isArmed()) {
      throw new KalshiConfigurationError(
        "KALSHI_KILLSWITCH_ARMED must be true before Kalshi live order submission"
      );
    }
  }
}

export class KalshiLiveExecutionAdapter implements ExecutionAdapter {
  readonly killswitch: KalshiKillswitch;
  private readonly exchangeOrderIds = new Map<string, string>();

  constructor(
    private readonly client = new KalshiClient(),
    killswitch = new KalshiKillswitch()
  ) {
    this.killswitch = killswitch;
  }

  async place(
    intent: TradeIntent,
    market: AgentMarket,
    now = new Date()
  ): Promise<ExecutionReceipt> {
    this.killswitch.assertCanSubmit();
    if (market.exchange && market.exchange !== "kalshi") {
      return {
        localOrderId: `kalshi-rejected-${now.getTime()}-${nanoid(8)}`,
        status: "rejected",
        submittedAt: now,
        rejectionReason: "Kalshi adapter received non-Kalshi market",
      };
    }
    const receipt = await placeKalshiLimitOrder(
      this.client,
      { ...intent, exchange: "kalshi" },
      { ...market, exchange: "kalshi" },
      now
    );
    if (receipt.exchangeOrderId) {
      this.exchangeOrderIds.set(receipt.localOrderId, receipt.exchangeOrderId);
    }
    return receipt;
  }

  sync(
    localOrderId: string,
    _market: AgentMarket,
    now = new Date()
  ): Promise<OrderLifecycleUpdate> {
    return getKalshiOrderStatus(
      this.client,
      localOrderId,
      this.exchangeOrderIds.get(localOrderId),
      now
    );
  }

  cancel(
    localOrderId: string,
    now = new Date()
  ): Promise<OrderLifecycleUpdate> {
    return cancelKalshiOrder(
      this.client,
      localOrderId,
      this.exchangeOrderIds.get(localOrderId),
      now
    );
  }
}

export async function createKalshiExecutionAdapter(): Promise<ExecutionAdapter> {
  if (ENV.kalshiExecutionMode === "live") {
    if (!ENV.kalshiEmail || !ENV.kalshiPassword) {
      throw new KalshiConfigurationError(
        "KALSHI_EMAIL and KALSHI_PASSWORD are required for Kalshi live execution"
      );
    }
    return new KalshiLiveExecutionAdapter();
  }
  return new PaperExecutionAdapter();
}

export async function getKalshiCashBalance(): Promise<number | null> {
  if (!ENV.kalshiEmail || !ENV.kalshiPassword) return null;
  const client = new KalshiClient();
  const body = await client.request<{
    balance?: number;
    portfolio?: { balance?: number };
  }>("/portfolio/balance");
  const cents = Number(body.balance ?? body.portfolio?.balance ?? 0);
  return Number.isFinite(cents) ? cents / 100 : null;
}

export {
  KalshiClient,
  listKalshiMarkets,
  getKalshiMarket,
  placeKalshiLimitOrder,
  cancelKalshiOrder,
  getKalshiOrderStatus,
};
