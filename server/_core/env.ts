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
  ollamaApiKey: process.env.OLLAMA_API_KEY ?? "",
  llmPrimaryModel:
    process.env.LLM_PRIMARY_MODEL ?? "deepseek-v4-pro",
  llmReasonerModel:
    process.env.LLM_REASONER_MODEL ?? "glm-5",
  llmExtractorModel:
    process.env.LLM_EXTRACTOR_MODEL ?? "qwen3.5:27b",
  llmFallbackProviders:
    process.env.LLM_FALLBACK_PROVIDERS ?? "openrouter,grok",
  openrouterApiKey: process.env.OPENROUTER_API_KEY ?? "",
  xBearerToken: process.env.X_BEARER_TOKEN ?? "",
  newsApiKey: process.env.NEWS_API_KEY ?? "",
  newsLookbackHours: Number(process.env.NEWS_LOOKBACK_HOURS ?? "24"),
  kalshiEmail: process.env.KALSHI_EMAIL ?? "",
  kalshiPassword: process.env.KALSHI_PASSWORD ?? "",
  kalshiExecutionMode:
    process.env.KALSHI_EXECUTION_MODE === "live" ? "live" : "paper",
  kalshiKillswitchArmed: process.env.KALSHI_KILLSWITCH_ARMED === "true",
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
  arbsXyzApiKey: process.env.ARBS_XYZ_API_KEY ?? "",
  arbsXyzBaseUrl: process.env.ARBS_XYZ_BASE_URL ?? "https://arbs.xyz",
  grokApiKey: process.env.GROK_API_KEY ?? "",
  grokModel: process.env.GROK_MODEL ?? "grok-3",
  groqApiKey: process.env.GROQ_API_KEY ?? "",
  groqModel: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
  // ─── Runtime tuning (spec §3.2) ────────────────────────────────────────
  orderTtlMs: Number(process.env.ORDER_TTL_MS ?? "300000"),
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? "15000"),
  maxPositionUsd: Number(process.env.MAX_POSITION_USD ?? "100"),
  maxDrawdownPct: Number(process.env.MAX_DRAWDOWN_PCT ?? "0.15") * 100,
};

/**
 * Fail fast if required credentials are absent when live trading is enabled.
 * Call this at bot startup before any orders can be placed.
 */
export function validateProductionEnv(): void {
  if (!ENV.liveTradingEnabled) return;

  const missing: string[] = [];

  if (!ENV.polymarketPrivateKey) missing.push("POLYMARKET_PRIVATE_KEY");
  if (!ENV.polymarketFunderAddress) missing.push("POLYMARKET_FUNDER_ADDRESS");
  if (!ENV.polymarketApiKey) missing.push("POLYMARKET_API_KEY");
  if (!ENV.polymarketApiSecret) missing.push("POLYMARKET_API_SECRET");
  if (!ENV.polymarketApiPassphrase) missing.push("POLYMARKET_API_PASSPHRASE");
  if (!ENV.databaseUrl) missing.push("DATABASE_URL");
  if (!ENV.cookieSecret) missing.push("JWT_SECRET");

  if (missing.length > 0) {
    throw new Error(
      `[ENV] Missing required production environment variables: ${missing.join(", ")}`
    );
  }
}
