# Polymarket Autonomous Betting Bot - TODO

## Phase 1: Core Infrastructure
- [ ] Database schema (markets, signals, orders, trades, equity_snapshots, bot_config)
- [ ] Drizzle ORM setup and migrations
- [ ] Database helper functions (queries, upserts)
- [ ] Environment variable configuration

## Phase 2: Data Ingestion
- [ ] Gamma API client (fetch markets, filter by volume/spread)
- [ ] Orderbook caching with Redis
- [ ] Market eligibility filtering
- [ ] Data ingestion background job

## Phase 3: Intelligence Layer
- [ ] LLM ensemble (invokeLLM with structured JSON output)
- [ ] Sentiment analysis pipeline (FinBERT or local model)
- [ ] Signal aggregation (combine LLM + sentiment + news)
- [ ] Invalid output guard (skip trade on malformed JSON)
- [ ] Bayesian prior lookup and update

## Phase 4: Strategy Layer
- [ ] Edge computation (P_est vs best ask/bid)
- [ ] Fractional Kelly sizing (capped at 0.5)
- [ ] Risk management engine (exposure limits, drawdown monitor)
- [ ] Emergency brake trigger (15% drawdown threshold)
- [ ] Owner notification on emergency brake

## Phase 5: Execution Layer
- [ ] GTC limit order placement (no market orders)
- [ ] Order lifecycle management (placement, timeout, repricing, cancellation)
- [ ] Nonce tracking and uniqueness
- [ ] Paper vs live execution modes
- [ ] All-orders-cancel on shutdown

## Phase 6: Background Polling Loop
- [ ] 15-second tick orchestration
- [ ] Market fetch → signal assembly → edge check → risk check → order placement
- [ ] Database logging of all decisions
- [ ] Graceful shutdown handling (SIGTERM)
- [ ] Pause/resume controls (SIGUSR1)

## Phase 7: Real-Time Dashboard UI
- [ ] DashboardLayout integration
- [ ] Equity curve chart (live balance, drawdown %)
- [ ] Open positions table with live updates
- [ ] Recent signals feed
- [ ] Risk gauges (current exposure, drawdown status)
- [ ] Bot status indicator (running/paused/emergency stop)
- [ ] Live order log with fill status

## Phase 8: Bot Control Panel
- [ ] Start/pause/resume controls
- [ ] Paper/live execution mode toggle
- [ ] Configuration editor (edge threshold, Kelly fraction, spread limits, drawdown limits)
- [ ] Real-time config validation
- [ ] Config persistence to database

## Phase 9: CLI-Equivalent tRPC Procedures
- [ ] Evaluate single market endpoint
- [ ] Backtest summary retrieval
- [ ] Calibration stats (Brier score, reliability curve)
- [ ] Trade log export (JSONL format)
- [ ] Market history and performance analytics

## Phase 10: Monitoring & Observability
- [ ] Prometheus metrics (equity, edge, orders placed, active positions)
- [ ] Structured JSON logging
- [ ] Health check endpoints
- [ ] Trade reconciliation (on-chain vs bot balance)
- [ ] Vitest unit tests for core modules

## Phase 11: Deployment & Documentation
- [ ] Systemd service file
- [ ] Deployment guide (Ubuntu 22.04)
- [ ] Configuration examples
- [ ] Verification commands
- [ ] Backtest report generation
- [ ] Paper trade logs (72-hour validation)
- [ ] Security scan (bandit, secret scanning)

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
