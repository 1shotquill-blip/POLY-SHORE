import { insertOrder, updateOrderStatus, updateOrderSyncState } from "../db";
import type { InsertOrder } from "../../drizzle/schema";
import type { OrderLifecycleUpdate } from "./execution-adapter";
import type { ExecutionReceipt, TradeIntent } from "./types";

export async function persistPaperOrderIntent(
  intent: TradeIntent,
  receipt: ExecutionReceipt
): Promise<void> {
  if (receipt.status !== "paper_accepted" || !receipt.exchangeOrderId) {
    await updateOrderSyncState(receipt.localOrderId, {
      status: "rejected",
      lifecycleState: "REJECTED",
      rejectionReason: receipt.rejectionReason ?? "Paper order rejected",
    });
    return;
  }

  const order: InsertOrder = {
    nonce: receipt.localOrderId,
    exchangeOrderId: receipt.exchangeOrderId,
    marketId: intent.marketId,
    tokenId: intent.tokenId,
    side: intent.side,
    price: intent.limitPrice.toString(),
    size: (intent.sizeUsd / intent.limitPrice).toString(),
    matchedSize: "0",
    status: "pending",
    lifecycleState: "ACCEPTED_BY_CLOB",
    edgeAtPlacement: intent.edge.toString(),
    confidenceAtPlacement: intent.confidence.toString(),
    placedAt: receipt.submittedAt,
    acceptedAt: receipt.submittedAt,
    lastSyncedAt: receipt.submittedAt,
  };

  await insertOrder(order);
}

export async function persistLifecycleUpdate(
  update: OrderLifecycleUpdate,
  limitPrice: number
): Promise<void> {
  const matchedTokenSize =
    limitPrice > 0 ? update.matchedSizeUsd / limitPrice : 0;

  if (update.status === "filled") {
    await updateOrderSyncState(update.localOrderId, {
      matchedSize: matchedTokenSize.toString(),
      status: "filled",
      lifecycleState: "FILLED",
    });
    return;
  }

  if (update.status === "partially_filled") {
    await updateOrderSyncState(update.localOrderId, {
      matchedSize: matchedTokenSize.toString(),
      status: "partially_filled",
      lifecycleState: "PARTIALLY_FILLED",
    });
    return;
  }

  if (update.status === "expired") {
    await updateOrderSyncState(update.localOrderId, {
      matchedSize: matchedTokenSize.toString(),
      status: "expired",
      lifecycleState: "EXPIRED",
    });
    return;
  }

  if (update.status === "cancel_requested") {
    await updateOrderStatus(update.localOrderId, "cancel_requested");
    return;
  }

  if (update.status === "cancelled") {
    await updateOrderSyncState(update.localOrderId, {
      matchedSize: matchedTokenSize.toString(),
      status: "cancelled",
      lifecycleState: "CANCEL_CONFIRMED",
    });
    return;
  }

  if (update.status === "rejected") {
    await updateOrderSyncState(update.localOrderId, {
      status: "rejected",
      lifecycleState: "REJECTED",
      rejectionReason: update.reason ?? "Order rejected",
    });
  }
}
