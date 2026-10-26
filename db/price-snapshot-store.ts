import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type { Retailer, SneakerData, SneakerDocument } from "../models/Sneaker.js";

const retailers: Retailer[] = ["stockX", "stadiumGoods", "goat", "flightClub"];
function serializeSneaker(shoe: SneakerDocument): SneakerData {
  return {
    styleID: shoe.styleID,
    imageLinks: [...shoe.imageLinks],
    resellLinks: { ...shoe.resellLinks },
    lowestResellPrice: { ...shoe.lowestResellPrice },
    resellPrices: Object.fromEntries(retailers.flatMap((retailer) => {
      const prices = shoe.resellPrices[retailer];
      return prices ? [[retailer, { ...prices }]] : [];
    })),
    providerErrors: shoe.providerErrors.map((error) => ({
      provider: error.provider,
      operation: error.operation,
      message: error.message,
    })),
    ...(shoe.shoeName === undefined ? {} : { shoeName: shoe.shoeName }),
    ...(shoe.brand === undefined ? {} : { brand: shoe.brand }),
    ...(shoe.silhoutte === undefined ? {} : { silhoutte: shoe.silhoutte }),
    ...(shoe.retailPrice === undefined ? {} : { retailPrice: shoe.retailPrice }),
    ...(shoe.releaseDate === undefined ? {} : { releaseDate: shoe.releaseDate }),
    ...(shoe.priceDataUpdatedAt === undefined ? {} : { priceDataUpdatedAt: shoe.priceDataUpdatedAt }),
    ...(shoe.description === undefined ? {} : { description: shoe.description }),
    ...(shoe.thumbnail === undefined ? {} : { thumbnail: shoe.thumbnail }),
    ...(shoe.urlKey === undefined ? {} : { urlKey: shoe.urlKey }),
    ...(shoe.make === undefined ? {} : { make: shoe.make }),
    ...(shoe.goatProductId === undefined ? {} : { goatProductId: shoe.goatProductId }),
    ...(shoe.colorway === undefined ? {} : { colorway: shoe.colorway }),
    ...(shoe.size === undefined ? {} : { size: shoe.size }),
  };
}

export class NeonPriceSnapshotStore {
  private readonly sql: NeonQueryFunction<false, false>;
  private schemaReady: Promise<void> | undefined;

  constructor(connectionString: string) {
    this.sql = neon(connectionString);
  }

  async save(shoe: SneakerDocument, freshForMs: number, recordAccess = true): Promise<void> {
    await this.ensureSchema();
    const snapshot = JSON.stringify(serializeSneaker(shoe));
    const fetchedAt = shoe.priceDataUpdatedAt ?? new Date().toISOString();
    await this.sql`
      INSERT INTO sneaker_price_snapshots (style_id, snapshot, fetched_at, fresh_until, last_requested_at)
      VALUES (
        ${shoe.styleID},
        ${snapshot}::jsonb,
        ${fetchedAt}::timestamptz,
        ${fetchedAt}::timestamptz + (${freshForMs} * INTERVAL '1 millisecond'),
        NOW()
      )
      ON CONFLICT (style_id) DO UPDATE SET
        snapshot = EXCLUDED.snapshot,
        fetched_at = EXCLUDED.fetched_at,
        fresh_until = EXCLUDED.fresh_until,
        last_requested_at = CASE
          WHEN ${recordAccess} THEN NOW()
          ELSE sneaker_price_snapshots.last_requested_at
        END
      WHERE sneaker_price_snapshots.fetched_at <= EXCLUDED.fetched_at
    `;
  }

  async deleteBefore(styleID: string, scrapeStartedAt: string): Promise<void> {
    await this.ensureSchema();
    await this.sql`
      DELETE FROM sneaker_price_snapshots
      WHERE style_id = ${styleID} AND fetched_at < ${scrapeStartedAt}::timestamptz
    `;
  }

  async findExpired(limit: number): Promise<string[]> {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT style_id
      FROM sneaker_price_snapshots
      WHERE fresh_until <= NOW()
        AND last_requested_at >= NOW() - INTERVAL '30 days'
      ORDER BY fresh_until ASC, style_id ASC
      LIMIT ${limit}
    `;
    return rows.flatMap((row) => typeof row["style_id"] === "string" ? [row["style_id"]] : []);
  }

  async deleteInactive(inactiveDays: number): Promise<void> {
    await this.ensureSchema();
    await this.sql`
      DELETE FROM sneaker_price_snapshots
      WHERE last_requested_at < NOW() - (${inactiveDays} * INTERVAL '1 day')
    `;
  }

  private async ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = (async () => {
        await this.sql`
          CREATE TABLE IF NOT EXISTS sneaker_price_snapshots (
            style_id TEXT PRIMARY KEY,
            snapshot JSONB NOT NULL,
            fetched_at TIMESTAMPTZ NOT NULL,
            fresh_until TIMESTAMPTZ NOT NULL,
            last_requested_at TIMESTAMPTZ NOT NULL
          )
        `;
        await this.sql`
          CREATE INDEX IF NOT EXISTS sneaker_price_snapshots_refresh_idx
          ON sneaker_price_snapshots (fresh_until, last_requested_at)
        `;
      })().catch((error: unknown) => {
        this.schemaReady = undefined;
        throw error;
      });
    }
    await this.schemaReady;
  }
}

let activeStore: { connectionString: string; store: NeonPriceSnapshotStore } | undefined;

export function getPriceSnapshotStore(): NeonPriceSnapshotStore | undefined {
  const connectionString = process.env.NEON_DATABASE_URL?.trim();
  if (!connectionString) return undefined;
  if (activeStore?.connectionString !== connectionString) {
    activeStore = { connectionString, store: new NeonPriceSnapshotStore(connectionString) };
  }
  return activeStore.store;
}
