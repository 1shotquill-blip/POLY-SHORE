import { nanoid } from "nanoid";
import { insertOrder, updateOrderStatus } from "./db";
import type { InsertOrder } from "../drizzle/schema";

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
  status: "pending" | "error";
  reason?: string;
}

/**
 * Generate unique nonce for order tracking
 */
export function generateNonce(): string {
  return `${Date.now()}-${nanoid(8)}`;
}

/**
 * Place a GTC (Good-Till-Cancelled) limit order
 * In paper mode: simulate placement
 * In live mode: call Polymarket CLOB API (stubbed)
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

    if (executionMode === "live") {
      return {
        nonce,
        status: "error",
        reason: "Live CLOB execution is disabled until signed order placement is implemented",
      };
    }

    // Create order record
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

    // Insert into database
    await insertOrder(orderData);

    // Paper mode: simulate successful placement
    console.log(`[PAPER] Order placed: ${nonce} - ${input.side} ${input.size} @ ${input.price}`);
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
export async function cancelOrder(nonce: string, executionMode: "paper" | "live"): Promise<boolean> {
  try {
    if (executionMode === "live") {
      console.error("[Execution] Refusing live cancel: CLOB cancellation adapter is not implemented");
      return false;
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
 * Monitor order fill status (placeholder for WebSocket/polling)
 */
export async function checkOrderFill(nonce: string, executionMode: "paper" | "live"): Promise<boolean> {
  try {
    if (executionMode === "live") {
      // TODO: Poll Polymarket CLOB API or listen to WebSocket for fill status
    }
    // In paper mode, simulate fill after random delay
    return false;
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
