import { describe, expect, it } from "vitest";
import { scanTradableMarkets } from "./market-scanner";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("market scanner", () => {
  it("rejects markets with wide CLOB spreads", async () => {
    const httpClient = {
      fetch: async (input: string | URL) => {
        const url = String(input);
        if (url.includes("/markets")) {
          return jsonResponse([
            {
              id: "wide-market",
              question: "Will this happen?",
              clobTokenIds: '["yes-token","no-token"]',
              active: true,
              closed: false,
              enableOrderBook: true,
              volume24hr: "25000",
              liquidity: "1500",
              endDate: "2030-01-01T00:00:00Z",
            },
          ]);
        }

        return jsonResponse({
          market: "condition-1",
          timestamp: String(Math.floor(Date.now() / 1000)),
          bids: [{ price: "0.40", size: "500" }],
          asks: [{ price: "0.50", size: "400" }],
        });
      },
    };

    const result = await scanTradableMarkets({ limit: 10, httpClient });

    expect(result.tradable).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.reason).toBe("wide_spread");
  });
});
