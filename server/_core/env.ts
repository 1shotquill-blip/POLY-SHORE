export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  liveTradingEnabled: process.env.LIVE_TRADING_ENABLED === "true",
  ollamaHost: process.env.OLLAMA_HOST ?? "http://localhost:11434",
  ollamaModel: process.env.OLLAMA_MODEL ?? "llama3.1:8b",
  deepEdgeMinScore: Number(process.env.DEEP_EDGE_MIN_SCORE ?? "0.7"),
  deepEdgeMinConfidence: Number(process.env.DEEP_EDGE_MIN_CONFIDENCE ?? "0.8"),
  maxBasketLegs: Number(process.env.MAX_BASKET_LEGS ?? "10"),
  catalystTimeoutMultiplier: Number(
    process.env.CATALYST_TIMEOUT_MULTIPLIER ?? "1.5"
  ),
  polymarketClobHost:
    process.env.POLYMARKET_HOST ??
    process.env.POLYMARKET_CLOB_HOST ??
    "https://clob.polymarket.com",
  polymarketChainId: Number(process.env.POLYMARKET_CHAIN_ID ?? "137"),
  polymarketPrivateKey: process.env.POLYMARKET_PRIVATE_KEY ?? "",
  polymarketFunderAddress: process.env.POLYMARKET_FUNDER_ADDRESS ?? "",
  polymarketSignatureType: Number(process.env.POLYMARKET_SIGNATURE_TYPE ?? "0"),
  polymarketApiKey: process.env.POLYMARKET_API_KEY ?? "",
  polymarketApiSecret: process.env.POLYMARKET_API_SECRET ?? "",
  polymarketApiPassphrase: process.env.POLYMARKET_API_PASSPHRASE ?? "",
  polygonRpcUrl: process.env.POLYGON_RPC_URL ?? "",
  polymarketCredentialCachePath:
    process.env.POLYMARKET_CREDENTIAL_CACHE_PATH ??
    ".polymarket-l2-credentials.enc",
  polymarketCredentialCacheKey:
    process.env.POLYMARKET_CREDENTIAL_CACHE_KEY ?? "",
  polymarketWsUrl: process.env.POLYMARKET_WS_URL ?? "",
  polymarketDefaultTickSize: process.env.POLYMARKET_DEFAULT_TICK_SIZE ?? "0.01",
  polymarketKillswitchArmed:
    process.env.KILLSWITCH_ARMED === "true" ||
    process.env.POLYMARKET_KILLSWITCH_ARMED === "true",
  polymarketMaxNotionalUsd: Number(
    process.env.KILLSWITCH_NOTIONAL_CAP_USD ??
      process.env.POLYMARKET_MAX_NOTIONAL_USD ??
      "100"
  ),
  polymarketMaxOrdersPerMinute: Number(
    process.env.KILLSWITCH_ORDERS_PER_MIN ??
      process.env.POLYMARKET_MAX_ORDERS_PER_MINUTE ??
      "6"
  ),
  polymarketPerMarketCapUsd: Number(
    process.env.KILLSWITCH_PER_MARKET_CAP_USD ??
      process.env.POLYMARKET_PER_MARKET_CAP_USD ??
      "100"
  ),
  polymarketMaxSpreadBps: Number(
    process.env.KILLSWITCH_MAX_SPREAD_BPS ??
      process.env.POLYMARKET_MAX_SPREAD_BPS ??
      "500"
  ),
  grokApiKey: process.env.GROK_API_KEY ?? "",
  grokModel: process.env.GROK_MODEL ?? "grok-3",
  // ─── Runtime tuning (spec §3.2) ────────────────────────────────────────
  orderTtlMs: Number(process.env.ORDER_TTL_MS ?? "300000"),
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? "15000"),
  maxPositionUsd: Number(process.env.MAX_POSITION_USD ?? "100"),
  maxDrawdownPct: Number(process.env.MAX_DRAWDOWN_PCT ?? "0.15") * 100,
};
