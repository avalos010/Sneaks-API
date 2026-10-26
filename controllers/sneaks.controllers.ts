import stockXScraper from "../scrapers/stockx-scraper.js";
import flightClubScraper from "../scrapers/flightclub-scraper.js";
import goatScraper from "../scrapers/goat-scraper.js";
import stadiumGoodsScraper from "../scrapers/stadiumgoods-scraper.js";
import klektScraper from "../scrapers/klekt-scraper.js";
import { normalizeStyleID } from "../scrapers/goat-catalog.js";
import Sneaker, { type ProviderError, type Retailer, type SneakerDocument } from "../models/Sneaker.js";
import { RequestCache } from "./request-cache.js";

export type SneaksCallback<T> = (error: Error | null, result: T | null) => void;

export interface SneaksCacheOptions {
  enabled?: boolean;
  searchTtlMs?: number;
  priceTtlMs?: number;
  /** Maximum entries in each of the catalog and product-price caches. */
  maxEntries?: number;
  now?: () => number;
}

export interface SneaksAPIOptions {
  cache?: SneaksCacheOptions;
}

function numericSetting(value: unknown, fallback: number, minimum: number): number {
  if (value === undefined || value === "") return fallback;
  const number = typeof value === "number" || typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isSafeInteger(number) && number >= minimum ? number : fallback;
}

function cloneSneaker(shoe: SneakerDocument): SneakerDocument {
  return new Sneaker(shoe.toObject());
}

export class ProductNotFoundError extends Error {
  constructor() {
    super("No Products Found");
    this.name = "ProductNotFoundError";
  }
}

function withCallback<T>(operation: Promise<T>, callback: SneaksCallback<T>): Promise<void> {
  // Separate handlers keep exceptions thrown by the consumer out of the error callback.
  return operation.then(
    (result) => callback(null, result),
    (error: unknown) => callback(error instanceof Error ? error : new Error(String(error)), null),
  );
}

interface Enrichment {
  provider: ProviderError["provider"];
  operation: ProviderError["operation"];
  run: () => Promise<void>;
}

async function enrich(shoe: SneakerDocument, operations: Enrichment[]): Promise<void> {
  const results = await Promise.allSettled(operations.map((operation) => operation.run()));
  for (const [index, result] of results.entries()) {
    const operation = operations[index];
    if (result.status === "rejected" && operation) {
      const reason: unknown = result.reason;
      shoe.providerErrors.push({
        provider: operation.provider,
        operation: operation.operation,
        message: reason instanceof Error ? reason.message : "Provider request failed",
      });
    }
  }
}

class SneaksAPI {
  private readonly catalogCache: RequestCache<SneakerDocument[]>;
  private readonly priceCache: RequestCache<SneakerDocument>;
  private readonly sellerPriceCache: RequestCache<SneakerDocument>;

  constructor(options: SneaksAPIOptions = {}) {
    const cache = options.cache ?? {};
    const enabled = cache.enabled ?? !/^(?:false|0|off)$/i.test(process.env.SNEAKS_CACHE_ENABLED?.trim() ?? "");
    const maxEntries = numericSetting(cache.maxEntries ?? process.env.SNEAKS_CACHE_MAX_ENTRIES, 100, 1);
    this.catalogCache = new RequestCache({
      enabled,
      maxEntries,
      ttlMs: numericSetting(cache.searchTtlMs ?? process.env.SNEAKS_SEARCH_CACHE_TTL_MS, 60_000, 0),
      clone: (products) => products.map(cloneSneaker),
      isCacheable: (products) => products.every((shoe) => shoe.providerErrors.length === 0),
      now: cache.now,
    });
    this.priceCache = new RequestCache({
      enabled,
      maxEntries,
      ttlMs: numericSetting(cache.priceTtlMs ?? process.env.SNEAKS_PRICE_CACHE_TTL_MS, 30_000, 0),
      clone: cloneSneaker,
      isCacheable: (shoe) => shoe.providerErrors.length === 0,
      now: cache.now,
    });
    this.sellerPriceCache = new RequestCache({
      enabled, maxEntries,
      ttlMs: numericSetting(cache.priceTtlMs ?? process.env.SNEAKS_PRICE_CACHE_TTL_MS, 30_000, 0),
      clone: cloneSneaker,
      isCacheable: (shoe) => shoe.providerErrors.length === 0,
      now: cache.now,
    });
  }

  getProducts(keyword: string, count?: number): Promise<SneakerDocument[]>;
  getProducts(keyword: string, count: number, callback: SneaksCallback<SneakerDocument[]>): Promise<void>;
  getProducts(
    keyword: string,
    count = 40,
    callback?: SneaksCallback<SneakerDocument[]>,
  ): Promise<SneakerDocument[] | void> {
    const operation = this.catalogCache.get(JSON.stringify(["search", keyword, count]), () => this.findProducts(keyword, count, true));
    return callback ? withCallback(operation, callback) : operation;
  }

  getCatalogProducts(keyword: string, count = 40): Promise<SneakerDocument[]> {
    return this.catalogCache.get(JSON.stringify(["catalog-only", keyword, count]),
      () => goatScraper.getProductsAndInfo(keyword, count));
  }

  getSellerPrices(styleID: string, provider: Retailer): Promise<SneakerDocument> {
    const normalizedStyleID = normalizeStyleID(styleID);
    return this.sellerPriceCache.get(JSON.stringify([normalizedStyleID, provider]), async () => {
      const products = await this.getCatalogProducts(normalizedStyleID, 1);
      const match = products[0];
      if (!match || normalizeStyleID(match.styleID) !== normalizedStyleID) throw new ProductNotFoundError();
      // Each provider gets its own document so concurrent requests cannot mutate
      // the shared catalog snapshot or leak another seller's partial response.
      const shoe = cloneSneaker(match);
      if (provider === "flightClub") {
        await enrich(shoe, [{ provider, operation: "links", run: () => flightClubScraper.getLink(shoe) }]);
        await enrich(shoe, [{ provider, operation: "prices", run: () => flightClubScraper.getPrices(shoe) }]);
      } else if (provider === "stadiumGoods") {
        // The exact-match discovery also retrieves the product's current prices.
        await enrich(shoe, [{ provider, operation: "links", run: () => stadiumGoodsScraper.getLink(shoe) }]);
      } else if (provider === "goat") {
        await enrich(shoe, [{ provider, operation: "prices", run: () => goatScraper.getPrices(shoe) }]);
      } else if (provider === "klekt") {
        await enrich(shoe, [{ provider, operation: "prices", run: () => klektScraper.getPrices(shoe) }]);
      } else {
        await enrich(shoe, [{ provider, operation: "prices", run: () => stockXScraper.getPrices(shoe) }]);
      }
      return shoe;
    });
  }

  getProductPrices(styleID: string): Promise<SneakerDocument>;
  getProductPrices(styleID: string, callback: SneaksCallback<SneakerDocument>): Promise<void>;
  getProductPrices(
    styleID: string,
    callback?: SneaksCallback<SneakerDocument>,
  ): Promise<SneakerDocument | void> {
    const normalizedStyleID = normalizeStyleID(styleID);
    const operation = this.priceCache.get(normalizedStyleID, () => this.findProductPrices(normalizedStyleID));
    return callback ? withCallback(operation, callback) : operation;
  }

  getMostPopular(count?: number): Promise<SneakerDocument[]>;
  getMostPopular(count: number, callback: SneaksCallback<SneakerDocument[]>): Promise<void>;
  getMostPopular(
    count = 40,
    callback?: SneaksCallback<SneakerDocument[]>,
  ): Promise<SneakerDocument[] | void> {
    const operation = this.catalogCache.get(JSON.stringify(["popular", count]), () => this.findProducts("", count));
    return callback ? withCallback(operation, callback) : operation;
  }

  private async findProducts(keyword: string, count: number, includePrices = false): Promise<SneakerDocument[]> {
    const products = await goatScraper.getProductsAndInfo(keyword, count);
    // Bound storefront traffic for the default forty-product response.
    for (let offset = 0; offset < products.length; offset += 5) {
      await Promise.all(products.slice(offset, offset + 5).map(async (shoe) => {
        await enrich(shoe, [
          { provider: "flightClub", operation: "links", run: () => flightClubScraper.getLink(shoe) },
          { provider: "stadiumGoods", operation: "links", run: () => stadiumGoodsScraper.getLink(shoe) },
        ]);
        if (includePrices) await this.enrichPrices(shoe);
      }));
    }
    return products;
  }

  private async findProductPrices(styleID: string): Promise<SneakerDocument> {
    const normalizedStyleID = normalizeStyleID(styleID);
    const products = await this.catalogCache.get(JSON.stringify(["catalog", normalizedStyleID, 1]),
      () => this.findProducts(normalizedStyleID, 1));
    const shoe = products[0];
    if (!shoe || normalizeStyleID(shoe.styleID) !== normalizedStyleID) {
      throw new ProductNotFoundError();
    }
    await Promise.all([
      this.enrichPrices(shoe),
      enrich(shoe, [{ provider: "goat", operation: "pictures", run: () => goatScraper.getPictures(shoe) }]),
    ]);
    return shoe;
  }

  private async enrichPrices(shoe: SneakerDocument): Promise<void> {
    const operations: Enrichment[] = [
      { provider: "stockX", operation: "prices", run: () => stockXScraper.getPrices(shoe) },
      { provider: "stadiumGoods", operation: "prices", run: () => stadiumGoodsScraper.getPrices(shoe) },
      { provider: "flightClub", operation: "prices", run: () => flightClubScraper.getPrices(shoe) },
      { provider: "goat", operation: "prices", run: () => goatScraper.getPrices(shoe) },
      { provider: "klekt", operation: "prices", run: () => klektScraper.getPrices(shoe) },
    ];
    await enrich(shoe, operations);
  }
}

export default SneaksAPI;
