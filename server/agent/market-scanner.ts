import { classifyMarketData, DEFAULT_RISK_LIMITS } from "./risk-manager";
import { scanPolymarketCandidates } from "./polymarket-client";
import type { AgentMarket, RiskLimits } from "./types";
import type { MarketScanOptions } from "./polymarket-client";

export interface ScannerResult {
  tradable: AgentMarket[];
  rejected: Array<{
    market: AgentMarket;
    reason: string;
  }>;
}

export async function scanTradableMarkets(
  options: MarketScanOptions,
  limits: RiskLimits = DEFAULT_RISK_LIMITS,
  now = new Date()
): Promise<ScannerResult> {
  const candidates = await scanPolymarketCandidates(options);
  const tradable: AgentMarket[] = [];
  const rejected: ScannerResult["rejected"] = [];

  for (const market of candidates) {
    const status = classifyMarketData(market, limits, now);
    if (status === "fresh") {
      tradable.push(market);
    } else {
      rejected.push({ market, reason: status });
    }
  }

  return { tradable, rejected };
}
