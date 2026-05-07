import { DEFAULT_RISK_LIMITS, evaluateRisk } from "./risk-manager";
import { PaperExecutionAdapter } from "./paper-execution";
import { createTickId, persistDecisionAudits } from "./audit-persistence";
import { persistLifecycleUpdate, persistPaperOrderIntent } from "./order-persistence";
import type { AgentMarket, ExecutionReceipt, PortfolioSnapshot, RiskDecision, RiskLimits } from "./types";
import type { IntelligenceEngine } from "./intelligence";
import type { ExecutionAdapter, OrderLifecycleUpdate } from "./execution-adapter";

export interface MarketProvider {
  scan(now?: Date): Promise<AgentMarket[]>;
}

export interface PortfolioProvider {
  snapshot(now?: Date): Promise<PortfolioSnapshot>;
}

export interface AgentDecisionAudit {
  marketId: string;
  question: string;
  market?: AgentMarket;
  action: "skipped" | "paper_order_submitted";
  reasons: string[];
  risk?: RiskDecision;
  receipt?: ExecutionReceipt;
  lifecycleUpdate?: OrderLifecycleUpdate;
}

export interface AgentTickResult {
  scannedMarkets: number;
  submittedOrders: number;
  skippedMarkets: number;
  audits: AgentDecisionAudit[];
}

export interface AgentOrchestratorOptions {
  marketProvider: MarketProvider;
  portfolioProvider: PortfolioProvider;
  intelligence: IntelligenceEngine;
  execution?: ExecutionAdapter;
  riskLimits?: RiskLimits;
  maxOrdersPerTick?: number;
  persistOrders?: boolean;
  persistAudits?: boolean;
}

export class AgentOrchestrator {
  private readonly marketProvider: MarketProvider;
  private readonly portfolioProvider: PortfolioProvider;
  private readonly intelligence: IntelligenceEngine;
  private readonly execution: ExecutionAdapter;
  private readonly riskLimits: RiskLimits;
  private readonly maxOrdersPerTick: number;
  private readonly persistOrders: boolean;
  private readonly persistAudits: boolean;

  constructor(options: AgentOrchestratorOptions) {
    this.marketProvider = options.marketProvider;
    this.portfolioProvider = options.portfolioProvider;
    this.intelligence = options.intelligence;
    this.execution = options.execution ?? new PaperExecutionAdapter();
    this.riskLimits = options.riskLimits ?? DEFAULT_RISK_LIMITS;
    this.maxOrdersPerTick = options.maxOrdersPerTick ?? 1;
    this.persistOrders = options.persistOrders ?? true;
    this.persistAudits = options.persistAudits ?? true;
  }

  async tick(now = new Date()): Promise<AgentTickResult> {
    const tickId = createTickId(now);
    const markets = await this.marketProvider.scan(now);
    const portfolio = await this.portfolioProvider.snapshot(now);
    const audits: AgentDecisionAudit[] = [];
    let submittedOrders = 0;

    if (portfolio.reconciliationStatus !== "ok") {
      const audits: AgentDecisionAudit[] = markets.map((market) => ({
        marketId: market.marketId,
        question: market.question,
        market,
        action: "skipped",
        reasons: ["portfolio reconciliation is not clean"],
      }));
      if (this.persistAudits) await persistDecisionAudits(tickId, audits);

      return {
        scannedMarkets: markets.length,
        submittedOrders: 0,
        skippedMarkets: markets.length,
        audits,
      };
    }

    for (const market of markets) {
      if (submittedOrders >= this.maxOrdersPerTick) {
        audits.push({
          marketId: market.marketId,
          question: market.question,
          market,
          action: "skipped",
          reasons: ["max orders per tick reached"],
        });
        continue;
      }

      const ensemble = await this.intelligence.evaluate(market, now);
      if (!ensemble) {
        audits.push({
          marketId: market.marketId,
          question: market.question,
          market,
          action: "skipped",
          reasons: ["no high-confidence ensemble decision"],
        });
        continue;
      }

      const risk = evaluateRisk(market, ensemble, portfolio, this.riskLimits, now);
      if (!risk.allowed || !risk.intent) {
        audits.push({
          marketId: market.marketId,
          question: market.question,
          market,
          action: "skipped",
          reasons: risk.reasons,
          risk,
        });
        continue;
      }

      const receipt = await this.execution.place(risk.intent, market, now);
      if (this.persistOrders) await persistPaperOrderIntent(risk.intent, receipt);

      if (receipt.status !== "paper_accepted") {
        audits.push({
          marketId: market.marketId,
          question: market.question,
          market,
          action: "skipped",
          reasons: [receipt.rejectionReason ?? "paper execution rejected order"],
          risk,
          receipt,
        });
        continue;
      }

      const lifecycleUpdate = await this.execution.sync(receipt.localOrderId, market, now);
      if (this.persistOrders) await persistLifecycleUpdate(lifecycleUpdate, risk.intent.limitPrice);
      submittedOrders += 1;

      audits.push({
        marketId: market.marketId,
        question: market.question,
        market,
        action: "paper_order_submitted",
        reasons: [],
        risk,
        receipt,
        lifecycleUpdate,
      });
    }

    if (this.persistAudits) await persistDecisionAudits(tickId, audits);

    return {
      scannedMarkets: markets.length,
      submittedOrders,
      skippedMarkets: audits.filter((audit) => audit.action === "skipped").length,
      audits,
    };
  }
}
