# Polymarket Autonomous Betting Bot - TODO

## Phase 1: Core Infrastructure
- [x] Database schema (markets, signals, orders, trades, equity_snapshots, bot_config)
- [x] Drizzle ORM setup and migrations
- [x] Database helper functions (queries, upserts)
- [x] Environment variable configuration

## Phase 2: Data Ingestion
- [x] Gamma API client (fetch markets, filter by volume/spread)
- [x] Orderbook caching with Redis
- [x] Market eligibility filtering
- [x] Data ingestion background job

## Phase 3: Intelligence Layer
- [x] LLM ensemble (invokeLLM with structured JSON output)
- [x] Sentiment analysis pipeline (FinBERT or local model)
- [x] Signal aggregation (combine LLM + sentiment + news)
- [x] Invalid output guard (skip trade on malformed JSON)
- [x] Bayesian prior lookup and update

## Phase 4: Strategy Layer
- [x] Edge computation (P_est vs best ask/bid)
- [x] Fractional Kelly sizing (capped at 0.5)
- [x] Risk management engine (exposure limits, drawdown monitor)
- [x] Emergency brake trigger (15% drawdown threshold)
- [x] Owner notification on emergency brake

## Phase 5: Execution Layer
- [x] GTC limit order placement (no market orders)
- [x] Order lifecycle management (placement, timeout, repricing, cancellation)
- [x] Nonce tracking and uniqueness
- [x] Paper vs live execution modes
- [x] All-orders-cancel on shutdown

## Phase 6: Background Polling Loop
- [x] 15-second tick orchestration
- [x] Market fetch → signal assembly → edge check → risk check → order placement
- [x] Database logging of all decisions
- [x] Graceful shutdown handling (SIGTERM)
- [x] Pause/resume controls (SIGUSR1)

## Phase 7: Real-Time Dashboard UI
- [x] DashboardLayout integration
- [x] Equity curve chart (live balance, drawdown %)
- [x] Open positions table with live updates
- [x] Recent signals feed
- [x] Risk gauges (current exposure, drawdown status)
- [x] Bot status indicator (running/paused/emergency stop)
- [x] Live order log with fill status

## Phase 8: Bot Control Panel
- [x] Start/pause/resume controls
- [x] Paper/live execution mode toggle
- [x] Configuration editor (edge threshold, Kelly fraction, spread limits, drawdown limits)
- [x] Real-time config validation
- [x] Config persistence to database

## Phase 9: CLI-Equivalent tRPC Procedures
- [x] Evaluate single market endpoint
- [x] Backtest summary retrieval
- [x] Calibration stats (Brier score, reliability curve)
- [x] Trade log export (JSONL format)
- [x] Market history and performance analytics

## Phase 10: Monitoring & Observability
- [x] Prometheus metrics (equity, edge, orders placed, active positions)
- [x] Structured JSON logging
- [x] Health check endpoints
- [x] Trade reconciliation (on-chain vs bot balance)
- [x] Vitest unit tests for core modules

## Phase 11: Deployment & Documentation
- [x] Systemd service file
- [x] Deployment guide (Ubuntu 22.04)
- [x] Configuration examples
- [x] Verification commands
- [x] Backtest report generation
- [x] Paper trade logs (72-hour validation)
- [x] Security scan (bandit, secret scanning)

## Constraints (Non-Negotiable)
- GTC limit orders ONLY (no market orders)
- Invalid LLM output → full trade skip (no fallback)
- Emergency brake at exactly 15% drawdown with owner notification
- Kelly fraction ≤ 0.5, single-market exposure ≤ 5%, total exposure ≤ 30%
- 15-second polling interval
- 30-second order timeout re-evaluation window
- Private key never in config/logs (env var only)
- Stale orderbooks (>10s) discarded
- 24-hour equity reconciliation within 1 USDC
