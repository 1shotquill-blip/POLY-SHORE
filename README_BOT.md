# Polymarket Autonomous Betting Bot

A fully autonomous, risk-managed software agent that trades on Polymarket using local LLM intelligence (Ollama), ensemble probability estimation, and strict risk controls.

## Features

### Core Intelligence
- **LLM Ensemble**: Local Ollama LLM for probability estimation with structured JSON output validation
- **Sentiment Analysis**: Weighted aggregation of sentiment signals from news and social media
- **Bayesian Updating**: Combines prior probabilities with LLM and sentiment signals
- **Invalid Output Guard**: Strict validation; malformed LLM output results in immediate trade skip

### Risk Management
- **Fractional Kelly Criterion**: Position sizing capped at 0.5 for safety
- **Multi-Level Exposure Limits**: Single-market (5%) and total (30%) exposure caps
- **Drawdown Monitor**: Emergency brake at 15% drawdown with owner notification
- **Order Lifecycle Management**: GTC limit orders only, 30-second timeout re-evaluation

### Execution
- **Paper & Live Modes**: Test strategies risk-free before live trading
- **Nonce Tracking**: Unique order identifiers for full lifecycle tracking
- **Graceful Shutdown**: Cancels all open orders on stop
- **Pause/Resume**: Global pause with emergency brake recovery

### Monitoring & Control
- **Real-Time Dashboard**: Live equity curve, open orders, recent trades, risk metrics
- **tRPC Procedures**: CLI-equivalent endpoints for bot control and data retrieval
- **Prometheus Metrics**: Equity, edge, orders, trades, exposure tracking
- **Structured Logging**: JSON logs to file and console

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   15-Second Polling Loop                    │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
   ┌────▼────┐          ┌────▼────┐          ┌────▼────┐
   │  Market │          │ Signal  │          │ Order   │
   │Ingestion│          │Assembly │          │Execution│
   └────┬────┘          └────┬────┘          └────┬────┘
        │                    │                    │
        └────────┬───────────┴────────┬───────────┘
                 │                    │
            ┌────▼────────────────────▼────┐
            │   Intelligence Layer         │
            │ (LLM + Sentiment + Bayesian) │
            └────┬───────────────────┬─────┘
                 │                   │
            ┌────▼────────────────────▼────┐
            │   Strategy Layer             │
            │ (Edge + Kelly + Risk Check)  │
            └────┬───────────────────┬─────┘
                 │                   │
            ┌────▼────────────────────▼────┐
            │   Execution Layer            │
            │ (Order Placement & Tracking) │
            └────┬───────────────────┬─────┘
                 │                   │
            ┌────▼───────────────────▼────┐
            │   Database & Monitoring     │
            │ (MySQL + Prometheus)        │
            └─────────────────────────────┘
```

## Quick Start

### Prerequisites
- Node.js 18+
- MySQL 8.0+ or compatible
- Ollama with llama3:70b model (or compatible)

### Installation

```bash
# Clone and install
git clone https://github.com/1shotquill-blip/POLY-SHORE.git
cd POLY-SHORE
pnpm install

# Configure environment
cp .env.example .env.local
# Edit .env.local with your settings

# Run migrations
pnpm db:push

# Start development server
pnpm dev
```

Access dashboard at `http://localhost:3000/dashboard`

### Configuration

Key environment variables:
```bash
DATABASE_URL=mysql://user:pass@localhost/polymarket
POLYMARKET_PRIVATE_KEY=<hex-key-no-0x>
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=llama3:70b
EXECUTION_MODE=paper  # or 'live'
```

## Usage

### Dashboard Controls

1. **Start/Stop**: Begin or end bot execution
2. **Pause/Resume**: Temporarily halt trading (orders remain open)
3. **Mode Toggle**: Switch between paper and live execution
4. **Auto-Refresh**: Enable/disable 5-second dashboard refresh

### tRPC Endpoints

```typescript
// Get bot status
const status = await trpc.bot.status.query();

// Start/stop/pause/resume
await trpc.bot.start.mutate();
await trpc.bot.stop.mutate();
await trpc.bot.pause.mutate();
await trpc.bot.resume.mutate();

// Set execution mode
await trpc.bot.setExecutionMode.mutate({ mode: 'live' });

// Retrieve data
const trades = await trpc.bot.recentTrades.query({ limit: 20 });
const equity = await trpc.bot.equityHistory.query({ hoursBack: 24 });
const orders = await trpc.bot.openOrders.query();

// Update configuration
await trpc.bot.updateConfig.mutate({
  edgeThreshold: 0.06,
  kellyFraction: 0.3,
  drawdownLimit: 12,
});
```

## Core Modules

### `server/intelligence.ts`
- `runLLMEnsemble()`: Call Ollama with structured prompt, validate JSON
- `aggregateSentiment()`: Weighted sentiment aggregation
- `bayesianUpdate()`: Combine prior with LLM and sentiment
- `assembleEnsemble()`: Full signal assembly pipeline

### `server/strategy.ts`
- `computeEdge()`: Calculate buy/sell edge vs market price
- `computeKellySize()`: Fractional Kelly sizing (capped at 0.5)
- `checkRisk()`: Validate against exposure and drawdown limits
- `shouldTriggerEmergencyBrake()`: Check drawdown threshold

### `server/execution.ts`
- `placeGTCLimitOrder()`: Place GTC limit orders (paper/live)
- `cancelOrder()`: Cancel open orders
- `isOrderExpired()`: Check 30-second timeout
- `generateNonce()`: Unique order identifiers

### `server/ingestion.ts`
- `fetchEligibleMarkets()`: Query Gamma API, filter by volume/spread
- `cacheMarketData()`: Store market data in database
- `isOrderbookStale()`: Validate orderbook freshness (>10s = stale)

### `server/bot-engine.ts`
- `BotEngine` class: Main polling loop (15-second ticks)
- Orchestrates full trading cycle: fetch → analyze → execute
- Handles pause/resume, emergency brake, graceful shutdown

## Database Schema

### Core Tables
- `markets`: Tracked Polymarket markets with orderbook snapshots
- `signals`: External signals (news, sentiment, tweets)
- `orders`: All orders placed (pending, filled, cancelled)
- `trades`: Executed trades with P&L tracking
- `equity_snapshots`: Periodic balance and drawdown snapshots
- `bot_config`: Bot configuration and state
- `bayesian_priors`: Category-based probability priors

## Testing

```bash
# Run all tests
pnpm test

# Run specific test file
pnpm test server/bot.test.ts

# Watch mode
pnpm test --watch
```

Test coverage includes:
- Edge computation and Kelly sizing
- Risk management and emergency brake
- Sentiment aggregation and Bayesian updating
- Order placement and nonce generation

## Non-Negotiable Constraints

✓ **GTC Limit Orders Only**: No market orders ever  
✓ **Invalid LLM Output → Trade Skip**: No fallback guessing  
✓ **Emergency Brake at 15%**: Exact threshold with owner notification  
✓ **Kelly ≤ 0.5**: Hard cap on position sizing  
✓ **Single-Market Exposure ≤ 5%**: Per-market limit  
✓ **Total Exposure ≤ 30%**: Portfolio limit  
✓ **15-Second Polling**: Fixed cycle interval  
✓ **30-Second Order Timeout**: Re-evaluation window  
✓ **Private Key in Env Only**: Never in config/logs  
✓ **Stale Orderbooks Discarded**: >10 seconds = skip  

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for production setup, systemd service configuration, and monitoring.

### Quick Production Start

```bash
# Build
pnpm build

# Run
NODE_ENV=production pnpm start

# Or use systemd
sudo systemctl start polymarket-bot
```

## Monitoring

### Dashboard Metrics
- Equity curve with peak/drawdown
- Open positions with edge and confidence
- Recent trades with fill status
- Risk gauges (exposure, drawdown)
- Bot status (running/paused/emergency)

### Prometheus Metrics
- `bot_equity`: Current balance
- `bot_drawdown`: Current drawdown %
- `bot_exposure_total`: Total exposure %
- `bot_orders_placed`: Cumulative orders
- `bot_trades_executed`: Cumulative trades
- `bot_average_edge`: Mean edge at execution

### Logs
- Location: `.manus-logs/` directory
- Levels: DEBUG, INFO, WARN, ERROR
- Format: JSON with ISO timestamps

## Verification Checklist

Before live trading:

- [ ] Paper mode testing for 72+ hours
- [ ] Backtest over 30+ days of historical data (Sharpe > 0.5)
- [ ] Calibration report: Brier score and reliability curve
- [ ] All tests passing: `pnpm test`
- [ ] Lint and type check: `pnpm check`
- [ ] Security scan: `bandit` and secret scanning
- [ ] Database reconciliation: On-chain vs bot balance within 1 USDC
- [ ] Ollama model verified: `curl http://localhost:11434/api/generate`
- [ ] Private key never logged or committed
- [ ] Risk parameters reviewed and appropriate

## Known Limitations

- **No Docker**: Runs directly on host (systemd or manual)
- **Single LLM**: Ollama only (no external LLM providers)
- **No GUI**: CLI and Grafana dashboards only
- **No Market Orders**: GTC limit orders exclusively
- **No Fiat**: USDC settlement only
- **No Sub-15s Cycles**: Minimum 15-second polling
- **No Technical Analysis**: Signals-based only
- **No Manual Override**: Global pause/resume only

## Troubleshooting

### Bot not starting
```bash
# Check database
mysql -h localhost -u user -p polymarket -e "SELECT 1"

# Check Ollama
curl http://localhost:11434/api/generate -d '{"model":"llama3:70b","prompt":"test","stream":false}'

# Check logs
tail -f .manus-logs/devserver.log
```

### Orders not placing
- Verify execution mode (paper/live)
- Check edge threshold vs market prices
- Verify Polymarket API connectivity
- Check private key format (hex, no 0x)

### High latency
- Check Ollama inference time
- Monitor database query performance
- Consider increasing polling interval

## Contributing

Contributions welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Submit a pull request

## License

MIT

## Support

For issues, questions, or feature requests, open a GitHub issue or contact the development team.

---

**Built with**: Node.js, Express, tRPC, Drizzle ORM, React, Tailwind CSS, Ollama
