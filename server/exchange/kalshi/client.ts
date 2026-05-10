import { KalshiAuthManager } from "./auth";

export const KALSHI_BASE_URL =
  "https://trading-api.kalshi.com/trade-api/v2";

export interface KalshiClientOptions {
  baseUrl?: string;
  auth?: KalshiAuthManager;
}

export interface KalshiRequestOptions {
  method?: string;
  body?: unknown;
  authenticated?: boolean;
}

export class KalshiClient {
  private readonly baseUrl: string;
  private readonly auth: KalshiAuthManager;

  constructor(options: KalshiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? KALSHI_BASE_URL;
    this.auth =
      options.auth ??
      new KalshiAuthManager({
        baseUrl: this.baseUrl,
      });
  }

  async request<T>(
    path: string,
    options: KalshiRequestOptions = {}
  ): Promise<T> {
    return this.requestOnce<T>(path, options, false);
  }

  private async requestOnce<T>(
    path: string,
    options: KalshiRequestOptions,
    retried: boolean
  ): Promise<T> {
    const headers: Record<string, string> = {
      accept: "application/json",
    };
    if (options.body !== undefined) headers["content-type"] = "application/json";
    if (options.authenticated !== false) {
      headers.authorization = `Bearer ${await this.auth.getToken(retried)}`;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    if (response.status === 401 && !retried && options.authenticated !== false) {
      this.auth.clear();
      return this.requestOnce<T>(path, options, true);
    }
    if (!response.ok) {
      throw new Error(`Kalshi request failed: ${response.status}`);
    }
    return (await response.json()) as T;
  }
}
