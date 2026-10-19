import stockXScraper from "../scrapers/stockx-scraper.js";
import flightClubScraper from "../scrapers/flightclub-scraper.js";
import goatScraper from "../scrapers/goat-scraper.js";
import stadiumGoodsScraper from "../scrapers/stadiumgoods-scraper.js";
import { normalizeStyleID } from "../scrapers/goat-catalog.js";
import type { ProviderError, SneakerDocument } from "../models/Sneaker.js";

export type SneaksCallback<T> = (error: Error | null, result: T | null) => void;

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
  getProducts(keyword: string, count?: number): Promise<SneakerDocument[]>;
  getProducts(keyword: string, count: number, callback: SneaksCallback<SneakerDocument[]>): Promise<void>;
  getProducts(
    keyword: string,
    count = 40,
    callback?: SneaksCallback<SneakerDocument[]>,
  ): Promise<SneakerDocument[] | void> {
    const operation = this.findProducts(keyword, count);
    return callback ? withCallback(operation, callback) : operation;
  }

  getProductPrices(styleID: string): Promise<SneakerDocument>;
  getProductPrices(styleID: string, callback: SneaksCallback<SneakerDocument>): Promise<void>;
  getProductPrices(
    styleID: string,
    callback?: SneaksCallback<SneakerDocument>,
  ): Promise<SneakerDocument | void> {
    const operation = this.findProductPrices(styleID);
    return callback ? withCallback(operation, callback) : operation;
  }

  getMostPopular(count?: number): Promise<SneakerDocument[]>;
  getMostPopular(count: number, callback: SneaksCallback<SneakerDocument[]>): Promise<void>;
  getMostPopular(
    count = 40,
    callback?: SneaksCallback<SneakerDocument[]>,
  ): Promise<SneakerDocument[] | void> {
    const operation = this.findProducts("", count);
    return callback ? withCallback(operation, callback) : operation;
  }

  private async findProducts(keyword: string, count: number): Promise<SneakerDocument[]> {
    const products = await goatScraper.getProductsAndInfo(keyword, count);
    // Bound storefront traffic for the default forty-product response.
    for (let offset = 0; offset < products.length; offset += 5) {
      await Promise.all(products.slice(offset, offset + 5).map(async (shoe) => {
        await enrich(shoe, [
          { provider: "flightClub", operation: "links", run: () => flightClubScraper.getLink(shoe) },
          { provider: "stadiumGoods", operation: "links", run: () => stadiumGoodsScraper.getLink(shoe) },
        ]);
      }));
    }
    return products;
  }

  private async findProductPrices(styleID: string): Promise<SneakerDocument> {
    const normalizedStyleID = normalizeStyleID(styleID);
    const products = await this.findProducts(normalizedStyleID, 1);
    const shoe = products[0];
    if (!shoe || normalizeStyleID(shoe.styleID) !== normalizedStyleID) {
      throw new ProductNotFoundError();
    }
    const operations: Enrichment[] = [
      { provider: "stockX", operation: "prices", run: () => stockXScraper.getPrices(shoe) },
      { provider: "stadiumGoods", operation: "prices", run: () => stadiumGoodsScraper.getPrices(shoe) },
      { provider: "flightClub", operation: "prices", run: () => flightClubScraper.getPrices(shoe) },
      { provider: "goat", operation: "prices", run: () => goatScraper.getPrices(shoe) },
      { provider: "goat", operation: "pictures", run: () => goatScraper.getPictures(shoe) },
    ];
    await enrich(shoe, operations);
    return shoe;
  }
}

export default SneaksAPI;
