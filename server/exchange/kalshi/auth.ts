import { ENV } from "../../_core/env";

export interface KalshiAuthConfig {
  email?: string;
  password?: string;
  baseUrl?: string;
}

export interface KalshiTokenState {
  token: string;
  expiresAt?: Date;
}

export class KalshiConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KalshiConfigurationError";
  }
}

export class KalshiAuthManager {
  private tokenState: KalshiTokenState | null = null;
  private readonly baseUrl: string;

  constructor(private readonly config: KalshiAuthConfig = {}) {
    this.baseUrl =
      config.baseUrl ?? "https://trading-api.kalshi.com/trade-api/v2";
  }

  async getToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.tokenState?.token) return this.tokenState.token;

    const email = this.config.email ?? ENV.kalshiEmail;
    const password = this.config.password ?? ENV.kalshiPassword;
    if (!email || !password) {
      throw new KalshiConfigurationError(
        "KALSHI_EMAIL and KALSHI_PASSWORD are required for Kalshi live auth"
      );
    }

    const response = await fetch(`${this.baseUrl}/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!response.ok) {
      throw new Error(`Kalshi auth failed: ${response.status}`);
    }
    const body = (await response.json()) as Record<string, unknown>;
    const token = String(body.token ?? body.access_token ?? "");
    if (!token) throw new Error("Kalshi auth response did not include token");
    this.tokenState = { token };
    return token;
  }

  clear(): void {
    this.tokenState = null;
  }
}
