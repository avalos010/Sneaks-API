import { refreshPriceSnapshots } from "../jobs/refresh-price-snapshots.js";

export const config = { schedule: "@hourly" } as const;

export default async function scheduledPriceRefresh(request: Request): Promise<void> {
  const event: unknown = await request.json().catch(() => undefined);
  const nextRun = typeof event === "object" && event !== null && "next_run" in event ? event.next_run : undefined;
  console.info("[price-refresh] scheduled invocation", { nextRun });
  await refreshPriceSnapshots();
}
