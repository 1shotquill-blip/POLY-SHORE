import { describe, expect, it } from "vitest";
import { cancelOrder, placeGTCLimitOrder } from "./execution";

describe("execution safety", () => {
  it("does not pretend live order placement succeeded before CLOB execution is implemented", async () => {
    const result = await placeGTCLimitOrder(
      {
        marketId: "market-1",
        tokenId: "token-1",
        side: "buy",
        price: 0.5,
        size: 10,
        edgeAtPlacement: 0.1,
        confidenceAtPlacement: 0.8,
      },
      "live"
    );

    expect(result.status).toBe("error");
    expect(result.reason).toContain("Live CLOB execution is disabled");
  });

  it("does not mark live orders cancelled without CLOB confirmation", async () => {
    await expect(cancelOrder("nonce-1", "live")).resolves.toBe(false);
  });
});
