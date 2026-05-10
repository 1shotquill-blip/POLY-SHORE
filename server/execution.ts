import { nanoid } from "nanoid";
import {
  getOrderByNonce,
  insertOrder,
  updateOrderStatus,
  updateOrderSyncState,
} from "./db";
import { PolymarketAdapter } from "./exchange/polymarket";
import type { InsertOrder } from "../drizzle/schema";
import type { AgentMarket, TradeIntent } from "./agent/types";

/**
 * Execution Layer: Order placement, lifecycle management, and nonce tracking
 */

export interface OrderPlacementInput {
  marketId: string;
  tokenId: string;
  side: "buy" | "sell";
  price: number;
  size: number;
  edgeAtPlacement: number;
  confidenceAtPlacement: number;
}

export interface OrderPlacementOutput {
  nonce: string;
  orderId?: number;
  exchangeOrderId?: string;
  status: "pending" | "error";
  reason?: string;
}

/**
 * Generate unique nonce for order tracking
 */
export function generateNonce(): string {
  return `${Date.now()}-${nanoid(8)}`;
}

function toTradeIntent(input: OrderPlacementInput): TradeIntent {
  return {
    marketId: input.marketId,
    tokenId: input.tokenId,
    outcome: "yes",
    side: input.side,
    limitPrice: input.price,
    sizeUsd: input.size * input.price,
    edge: input.edgeAtPlacement,
    estimatedProbability: input.confidenceAtPlacement,
    confidence: input.confidenceAtPlacement,
    rationale: ["legacy execution facade"],
  };
}

function toAgentMarket(input: OrderPlacementInput): AgentMarket {
  return {
    marketId: input.marketId,
    question: input.marketId,
    yesTokenId: input.tokenId,
    noTokenId: "",
    bestBid:
      input.side === "sell" ? input.price : Math.max(0, input.price - 0.01),
    bestAsk:
      input.side === "buy" ? input.price : Math.min(1, input.price + 0.01),
    spread: 0.01,
    midpoint: input.price,
    volume24h: 0,
    liquidity: 0,
    expiresAt: new Date(Date.now() + 86_400_000),
    orderbookUpdatedAt: new Date(),
  };
}

function orderToTradeIntent(
  order: Awaited<ReturnType<typeof getOrderByNonce>>
): TradeIntent | null {
  if (!order) return null;
  const price = Number(order.price);
  const tokenSize = Number(order.size);
  if (!Number.isFinite(price) || !Number.isFinite(tokenSize)) {
    console.error(`[Execution] Corrupted order data for nonce ${order.nonce}: price=${order.price} size=${order.size}`);
    return null;
  }
  return {
    marketId: order.marketId,
    tokenId: order.tokenId,
    outcome: "yes",
    side: order.side,
    limitPrice: price,
    sizeUsd: tokenSize * price,
    edge: Number(order.edgeAtPlacement ?? 0),
    estimatedProbability: Number(order.confidenceAtPlacement ?? 0),
    confidence: Number(order.confidenceAtPlacement ?? 0),
    rationale: ["legacy execution facade"],
  };
}

/**
 * Place a GTC (Good-Till-Cancelled) limit order
 * In paper mode: persist a pending limit order for local lifecycle tracking.
 * In live mode: delegate to the fail-closed Polymarket CLOB adapter.
 */
export async function placeGTCLimitOrder(
  input: OrderPlacementInput,
  executionMode: "paper" | "live"
): Promise<OrderPlacementOutput> {
  const nonce = generateNonce();

  try {
    // Validate input
    if (input.size <= 0 || input.price < 0 || input.price > 1) {
      return {
        nonce,
        status: "error",
        reason: "Invalid size or price",
      };
    }

    const orderData: InsertOrder = {
      nonce,
      marketId: input.marketId,
      tokenId: input.tokenId,
      side: input.side,
      price: input.price.toString(),
      size: input.size.toString(),
      status: "pending",
      edgeAtPlacement: input.edgeAtPlacement.toString(),
      confidenceAtPlacement: input.confidenceAtPlacement.toString(),
      placedAt: new Date(),
    };

    if (executionMode === "live") {
      const adapter = await PolymarketAdapter.create();
      const receipt = await adapter.place(
        toTradeIntent(input),
        toAgentMarket(input)
      );
      if (receipt.status !== "exchange_accepted" || !receipt.exchangeOrderId) {
        await insertOrder({
          ...orderData,
          status: "rejected",
          lifecycleState: "REJECTED",
          rejectionReason:
            receipt.rejectionReason ?? "Polymarket rejected order",
        });
        return {
          nonce,
          status: "error",
          reason: receipt.rejectionReason ?? "Polymarket rejected order",
        };
      }

      await insertOrder({
        ...orderData,
        exchangeOrderId: receipt.exchangeOrderId,
        lifecycleState: "ACCEPTED_BY_CLOB",
        acceptedAt: receipt.submittedAt,
        lastSyncedAt: receipt.submittedAt,
      });
      return {
        nonce,
        exchangeOrderId: receipt.exchangeOrderId,
        status: "pending",
      };
    }

    await insertOrder(orderData);

    console.log(
      `[PAPER] Order placed: ${nonce} - ${input.side} ${input.size} @ ${input.price}`
    );
    return {
      nonce,
      status: "pending",
    };
  } catch (error) {
    console.error("[Execution] Error placing order:", error);
    return {
      nonce,
      status: "error",
      reason: String(error),
    };
  }
}

/**
 * Cancel an order
 */
export async function cancelOrder(
  nonce: string,
  executionMode: "paper" | "live"
): Promise<boolean> {
  try {
    if (executionMode === "live") {
      const order = await getOrderByNonce(nonce);
      if (!order?.exchangeOrderId) return false;
      const intent = orderToTradeIntent(order);
      if (!intent) return false;

      await updateOrderStatus(nonce, "cancel_requested");
      const adapter = await PolymarketAdapter.create();
      adapter.trackExternalOrder(nonce, order.exchangeOrderId, intent);
      const update = await adapter.cancel(nonce);
      await updateOrderSyncState(nonce, {
        matchedSize: update.matchedSizeUsd.toString(),
        status: "cancelled",
        lifecycleState: "CANCEL_CONFIRMED",
      });
      return update.status === "cancelled";
    }

    // Update database
    await updateOrderStatus(nonce, "cancelled");
    console.log(`[${executionMode.toUpperCase()}] Order cancelled: ${nonce}`);
    return true;
  } catch (error) {
    console.error("[Execution] Error cancelling order:", error);
    return false;
  }
}

/**
 * Read local order fill state and sync live CLOB status when live mode is active.
 */
export async function checkOrderFill(
  nonce: string,
  executionMode: "paper" | "live"
): Promise<boolean> {
  try {
    if (executionMode === "live") {
      const order = await getOrderByNonce(nonce);
      if (!order?.exchangeOrderId) return false;
      const intent = orderToTradeIntent(order);
      if (!intent) return false;

      const adapter = await PolymarketAdapter.create();
      adapter.trackExternalOrder(nonce, order.exchangeOrderId, intent);
      const update = await adapter.sync(
        nonce,
        toAgentMarket({
          marketId: order.marketId,
          tokenId: order.tokenId,
          side: order.side,
          price: Number(order.price),
          size: Number(order.size),
          edgeAtPlacement: Number(order.edgeAtPlacement ?? 0),
          confidenceAtPlacement: Number(order.confidenceAtPlacement ?? 0),
        })
      );
      await updateOrderSyncState(nonce, {
        matchedSize: update.matchedSizeUsd.toString(),
        status: update.status === "accepted" ? "pending" : update.status,
        lifecycleState:
          update.status === "filled"
            ? "FILLED"
            : update.status === "partially_filled"
              ? "PARTIALLY_FILLED"
              : "ACCEPTED_BY_CLOB",
      });
      return update.status === "filled";
    }

    const order = await getOrderByNonce(nonce);
    return order?.status === "filled";
  } catch (error) {
    console.error("[Execution] Error checking order fill:", error);
    return false;
  }
}

/**
 * Order timeout re-evaluation: if order not filled after timeout, cancel and re-evaluate
 */
export interface OrderTimeoutCheckInput {
  nonce: string;
  placedAt: Date;
  timeoutSeconds: number;
}

export function isOrderExpired(input: OrderTimeoutCheckInput): boolean {
  const elapsedSeconds = (Date.now() - input.placedAt.getTime()) / 1000;
  return elapsedSeconds > input.timeoutSeconds;
}
