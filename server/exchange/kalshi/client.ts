import { ENV } from "../../_core/env";
import { buildKalshiAuthHeaders, KalshiConfigurationError } from "./auth";

export const KALSHI_BASE_URL =
  "https://external-api.kalshi.com/trade-api/v2";

export interface KalshiClientOptions {
  baseUrl?: string;
}

export interface KalshiRequestOptions {
  method?: string;
  body?: unknown;
  /** If false, omit auth headers (for public endpoints) */
  authenticated?: boolean;
}

export class KalshiClient {
  private readonly baseUrl: string;

  constructor(options: KalshiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? ENV.kalshiApiBase ?? KALSHI_BASE_URL;
  }

  async request<T>(
    path: string,
    options: KalshiRequestOptions = {}
  ): Promise<T> {
    const method = (options.method ?? "GET").toUpperCase();
    const headers: Record<string, string> = {
      accept: "application/json",
    };
    if (options.body !== undefined) {
      headers["content-type"] = "application/json";
    }

    if (options.authenticated !== false) {
      const authHeaders = buildKalshiAuthHeaders(method, path);
      Object.assign(headers, authHeaders);
    }

    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      method,
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    if (!response.ok) {
      throw new Error(
        `Kalshi request failed: ${response.status} ${response.statusText} — ${method} ${path}`
      );
    }
    return (await response.json()) as T;
  }
}
