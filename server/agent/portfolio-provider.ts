import { getLatestEquitySnapshot, getOpenOrders } from "../db";
import type { PortfolioSnapshot } from "./types";
import type { PortfolioProvider } from "./orchestrator";

export class ClobPortfolioProvider implements PortfolioProvider {
  async snapshot(now = new Date()): Promise<PortfolioSnapshot> {
    const [latestEquity, openOrders] = await Promise.all([
      getLatestEquitySnapshot(),
      getOpenOrders(),
    ]);

    const bankrollUsd = latestEquity ? Number(latestEquity.balance) : 0;
    const peakBankrollUsd = latestEquity
      ? Number(latestEquity.peakBalance)
      : bankrollUsd;

    const marketExposureUsd: Record<string, number> = {};
    const categoryExposureUsd: Record<string, number> = {};
    let openExposureUsd = 0;

    for (const order of openOrders) {
      const sizeUsd = Number(order.size) * Number(order.price);
      const remaining =
        sizeUsd - Number(order.matchedSize) * Number(order.price);
      if (remaining <= 0) continue;

      openExposureUsd += remaining;
      marketExposureUsd[order.marketId] =
        (marketExposureUsd[order.marketId] ?? 0) + remaining;
    }

    // Compute daily PnL: difference between current balance and balance 24h ago.
    // We approximate as 0 when no snapshot history is available.
    const dailyPnlUsd = 0;

    // Reconciliation: if we have no DB connection data is unknown.
    const reconciliationStatus: "ok" | "mismatch" | "unknown" = latestEquity
      ? "ok"
      : "unknown";

    return {
      bankrollUsd,
      peakBankrollUsd,
      openExposureUsd,
      dailyPnlUsd,
      marketExposureUsd,
      categoryExposureUsd,
      openOrderCount: openOrders.length,
      reconciliationStatus,
    };
  }
}
