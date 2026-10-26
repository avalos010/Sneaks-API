import SneaksAPI from "../controllers/sneaks.controllers.js";
import { getPriceSnapshotStore } from "../db/price-snapshot-store.js";

export interface PriceRefreshSummary {
  attempted: number;
  refreshed: number;
  failed: number;
}

function refreshBatchSize(): number {
  const value = Number(process.env.SNEAKS_REFRESH_BATCH_SIZE ?? 1);
  return Number.isSafeInteger(value) && value >= 1 && value <= 3 ? value : 1;
}

export async function refreshPriceSnapshots(): Promise<PriceRefreshSummary> {
  const store = getPriceSnapshotStore();
  if (!store) {
    console.info("[price-refresh] skipped: NEON_DATABASE_URL is not configured");
    return { attempted: 0, refreshed: 0, failed: 0 };
  }

  await store.deleteInactive(30);
  const expiredStyleIDs = await store.findExpired(refreshBatchSize());
  const summary: PriceRefreshSummary = { attempted: 0, refreshed: 0, failed: 0 };
  const api = new SneaksAPI({
    cache: { enabled: false },
    trackPriceSnapshotUsage: false,
    failOnPriceSnapshotError: true,
  });

  for (const styleID of expiredStyleIDs) {
    summary.attempted += 1;
    try {
      const shoe = await api.getProductPrices(styleID);
      summary.refreshed += 1;
      console.info("[price-refresh] updated price snapshot", {
        styleID,
        priceDataUpdatedAt: shoe.priceDataUpdatedAt,
        providersWithErrors: shoe.providerErrors.length,
      });
    } catch (error: unknown) {
      summary.failed += 1;
      console.error("[price-refresh] refresh failed", {
        styleID,
        message: error instanceof Error ? error.message : "Unknown refresh error",
      });
    }
  }

  console.info("[price-refresh] run complete", summary);
  return summary;
}
