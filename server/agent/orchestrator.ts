import { DEFAULT_RISK_LIMITS, evaluateRisk } from "./risk-manager";
import { PaperExecutionAdapter } from "./paper-execution";
import { createTickId, persistDecisionAudits } from "./audit-persistence";
import {
  scoreOpportunity,
  type MarketSelectionScore,
} from "./market-selection";
import {
  persistLifecycleUpdate,
  persistPaperOrderIntent,
} from "./order-persistence";
import {
  ProductionDeepEdgeGate,
  type DeepEdgeDecision,
  type DeepEdgeGate,
} from "./deep-edge-gate";
import type {
  AgentMarket,
  EnsembleDecision,
  ExecutionReceipt,
  PortfolioSnapshot,
  RiskDecision,
  RiskLimits,
} from "./types";
import type { IntelligenceEngine } from "./intelligence";
import type {
  ExecutionAdapter,
  OrderLifecycleUpdate,
} from "./execution-adapter";

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
  ensemble?: EnsembleDecision;
  deepEdge?: DeepEdgeDecision;
  selectionScore?: MarketSelectionScore;
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
  deepEdgeGate?: DeepEdgeGate;
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
  private readonly deepEdgeGate: DeepEdgeGate;
  private readonly maxOrdersPerTick: number;
  private readonly persistOrders: boolean;
  private readonly persistAudits: boolean;

  constructor(options: AgentOrchestratorOptions) {
    this.marketProvider = options.marketProvider;
    this.portfolioProvider = options.portfolioProvider;
    this.intelligence = options.intelligence;
    this.execution = options.execution ?? new PaperExecutionAdapter();
    this.riskLimits = options.riskLimits ?? DEFAULT_RISK_LIMITS;
    this.deepEdgeGate = options.deepEdgeGate ?? new ProductionDeepEdgeGate();
    this.maxOrdersPerTick = options.maxOrdersPerTick ?? 1;
    this.persistOrders = options.persistOrders ?? true;
    this.persistAudits = options.persistAudits ?? true;
  }

  async tick(now = new Date()): Promise<AgentTickResult> {
    const tickId = createTickId(now);
    const markets = await this.marketProvider.scan(now);
    const portfolio = await this.portfolioProvider.snapshot(now);
    const audits: AgentDecisionAudit[] = [];
    const executableAudits: AgentDecisionAudit[] = [];

    if (portfolio.reconciliationStatus !== "ok") {
      const audits: AgentDecisionAudit[] = markets.map(market => ({
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

      const risk = evaluateRisk(
        market,
        ensemble,
        portfolio,
        this.riskLimits,
        now
      );
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

      executableAudits.push({
        marketId: market.marketId,
        question: market.question,
        market,
        action: "skipped",
        reasons: ["not selected for this tick"],
        ensemble,
        risk,
        deepEdge: await this.evaluateDeepEdgeOrSkip(
          market,
          ensemble,
          markets,
          now
        ),
        selectionScore: scoreOpportunity(market, risk, undefined, now),
      });
    }

    const blockedByDeepEdge = executableAudits.filter(
      audit => !audit.deepEdge?.allowed
    );
    for (const audit of blockedByDeepEdge) {
      audits.push({
        ...audit,
        action: "skipped",
        reasons: audit.deepEdge?.reasons ?? ["deep edge gate rejected trade"],
      });
    }

    const deepEdgeApprovedAudits = executableAudits.filter(
      audit => audit.deepEdge?.allowed
    );

    deepEdgeApprovedAudits.sort(
      (a, b) => (b.selectionScore?.total ?? 0) - (a.selectionScore?.total ?? 0)
    );
    const selectedAudits = deepEdgeApprovedAudits.slice(
      0,
      this.maxOrdersPerTick
    );
    const deferredAudits = deepEdgeApprovedAudits.slice(this.maxOrdersPerTick);
    let submittedOrders = 0;

    for (const audit of selectedAudits) {
      if (!audit.risk?.intent || !audit.market) continue;

      const receipt = await this.execution.place(
        audit.risk.intent,
        audit.market,
        now
      );
      if (this.persistOrders)
        await persistPaperOrderIntent(audit.risk.intent, receipt);

      if (receipt.status !== "paper_accepted") {
        audits.push({
          ...audit,
          action: "skipped",
          reasons: [
            receipt.rejectionReason ?? "paper execution rejected order",
          ],
          receipt,
        });
        continue;
      }

      const lifecycleUpdate = await this.execution.sync(
        receipt.localOrderId,
        audit.market,
        now
      );
      if (this.persistOrders)
        await persistLifecycleUpdate(
          lifecycleUpdate,
          audit.risk.intent.limitPrice
        );
      submittedOrders += 1;

      audits.push({
        ...audit,
        action: "paper_order_submitted",
        reasons: [],
        receipt,
        lifecycleUpdate,
      });
    }

    audits.push(...deferredAudits);

    if (this.persistAudits) await persistDecisionAudits(tickId, audits);

    return {
      scannedMarkets: markets.length,
      submittedOrders,
      skippedMarkets: audits.filter(audit => audit.action === "skipped").length,
      audits,
    };
  }

  private async evaluateDeepEdgeOrSkip(
    market: AgentMarket,
    ensemble: EnsembleDecision,
    markets: AgentMarket[],
    now: Date
  ): Promise<DeepEdgeDecision> {
    return this.deepEdgeGate.evaluate(
      market,
      ensemble,
      {
        peerMarkets: markets,
      },
      now
    );
  }
}
