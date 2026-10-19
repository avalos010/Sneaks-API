import stockXScraper from "../scrapers/stockx-scraper.js";
import flightClubScraper from "../scrapers/flightclub-scraper.js";
import goatScraper from "../scrapers/goat-scraper.js";
import stadiumGoodsScraper from "../scrapers/stadiumgoods-scraper.js";
import type { SneakerDocument } from "../models/Sneaker.js";

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
    const products = await stockXScraper.getProductsAndInfo(keyword, count);
    await Promise.all(products.map(async (shoe) => {
      await Promise.allSettled([
        flightClubScraper.getLink(shoe),
        stadiumGoodsScraper.getLink(shoe),
        goatScraper.getLink(shoe),
      ]);
    }));
    return products;
  }

  private async findProductPrices(styleID: string): Promise<SneakerDocument> {
    const products = await this.findProducts(styleID, 1);
    const shoe = products[0];
    if (!shoe || shoe.styleID.toLowerCase() !== styleID.toLowerCase()) {
      throw new ProductNotFoundError();
    }
    await Promise.allSettled([
      stockXScraper.getPrices(shoe),
      stadiumGoodsScraper.getPrices(shoe),
      flightClubScraper.getPrices(shoe),
      goatScraper.getPrices(shoe),
      goatScraper.getPictures(shoe),
    ]);
    return shoe;
  }
}

export default SneaksAPI;
