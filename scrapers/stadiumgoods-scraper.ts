import type { SneakerDocument } from "../models/Sneaker.js";
import http from "./http.js";

const storefront = "https://www.stadiumgoods.com";

interface StadiumSearchProduct {
  handle: string;
}

interface StadiumVariant {
  sku: string;
  available: boolean;
  price: number;
  options: string[];
}

interface StadiumProduct {
  variants: StadiumVariant[];
  options: { name: string; position: number }[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function styleKey(styleID: string): string {
  return styleID.replace(/[^a-z0-9]/gi, "").toUpperCase();
}

function matchesStyle(variant: StadiumVariant, styleID: string): boolean {
  const key = styleKey(styleID);
  // Current storefront SKUs use catalog ID|manufacturer style ID|size.
  const parts = variant.sku.split("|");
  const manufacturerStyle = parts.length > 1 ? parts[1] : variant.sku;
  return key.length > 0 && manufacturerStyle !== undefined && styleKey(manufacturerStyle) === key;
}

function parseSearch(value: unknown): StadiumSearchProduct[] {
  if (!isRecord(value) || !isRecord(value.resources) || !isRecord(value.resources.results)
    || !Array.isArray(value.resources.results.products)) {
    throw new Error("Invalid Stadium Goods search response");
  }
  const products: StadiumSearchProduct[] = [];
  for (const entry of value.resources.results.products) {
    if (isRecord(entry) && typeof entry.handle === "string" && /^[a-z0-9-]+$/.test(entry.handle)) {
      products.push({ handle: entry.handle });
    }
  }
  return products;
}

function parseProduct(value: unknown): StadiumProduct {
  if (!isRecord(value) || !Array.isArray(value.variants) || !Array.isArray(value.options)) {
    throw new Error("Invalid Stadium Goods product response");
  }
  const variants: StadiumVariant[] = [];
  for (const entry of value.variants) {
    if (!isRecord(entry) || typeof entry.sku !== "string"
      || typeof entry.available !== "boolean" || typeof entry.price !== "number"
      || !Array.isArray(entry.options)) continue;
    const options: string[] = [];
    for (const option of entry.options) {
      if (typeof option === "string") options.push(option);
    }
    if (options.length !== entry.options.length) continue;
    variants.push({ sku: entry.sku, available: entry.available, price: entry.price, options });
  }
  const options: StadiumProduct["options"] = [];
  for (const entry of value.options) {
    if (isRecord(entry) && typeof entry.name === "string" && typeof entry.position === "number"
      && Number.isInteger(entry.position) && entry.position > 0) {
      options.push({ name: entry.name, position: entry.position });
    }
  }
  return { variants, options };
}

function pricesFor(product: StadiumProduct, styleID: string): Record<string, number> {
  const prices: Record<string, number> = {};
  const sizeOption = product.options.find((option) => /^(?:shoe\s+)?size$/i.test(option.name));
  if (!sizeOption) return prices;
  for (const variant of product.variants) {
    if (!matchesStyle(variant, styleID) || !variant.available
      || !Number.isFinite(variant.price) || variant.price <= 0) continue;
    const size = variant.options[sizeOption.position - 1]?.trim().replace(/\s*W$/i, "");
    if (!size) continue;
    const amount = variant.price / 100;
    const previous = prices[size];
    prices[size] = previous === undefined ? amount : Math.min(previous, amount);
  }
  return prices;
}

function setPrices(shoe: SneakerDocument, prices: Record<string, number>): void {
  shoe.resellPrices.stadiumGoods = prices;
  const amounts = Object.values(prices);
  if (amounts.length > 0) shoe.lowestResellPrice.stadiumGoods = Math.min(...amounts);
  else delete shoe.lowestResellPrice.stadiumGoods;
}

async function getProduct(handle: string): Promise<StadiumProduct> {
  const value = await http.get(`${storefront}/products/${handle}.js`).json<unknown>();
  return parseProduct(value);
}

const stadiumGoodsScraper = {
  async getLink(shoe: SneakerDocument): Promise<void> {
    try {
      const value = await http.get(`${storefront}/search/suggest.json`, {
        searchParams: {
          q: shoe.styleID.replace(/[-_]+/g, " "),
          "resources[type]": "product",
          "resources[limit]": "10",
          "resources[options][unavailable_products]": "show",
        },
      }).json<unknown>();
      const products = parseSearch(value);
      // Predictive search is fuzzy: confirm the manufacturer style ID in the SKU.
      for (const { handle } of products) {
        const product = await getProduct(handle);
        if (!product.variants.some((variant) => matchesStyle(variant, shoe.styleID))) continue;
        shoe.resellLinks.stadiumGoods = `${storefront}/products/${handle}`;
        setPrices(shoe, pricesFor(product, shoe.styleID));
        return;
      }
    } catch (cause) {
      throw new Error(`Could not search Stadium Goods for '${shoe.styleID}'`, { cause });
    }
  },

  async getPrices(shoe: SneakerDocument): Promise<void> {
    const link = shoe.resellLinks.stadiumGoods;
    if (!link) return;
    try {
      const url = new URL(link, storefront);
      const match = /^\/products\/([a-z0-9-]+)\/?$/.exec(url.pathname);
      const handle = match?.[1];
      if (url.origin !== storefront || !handle) throw new Error("Invalid Stadium Goods product URL");
      const product = await getProduct(handle);
      if (!product.variants.some((variant) => matchesStyle(variant, shoe.styleID))) {
        throw new Error("Stadium Goods product does not match the requested style ID");
      }
      setPrices(shoe, pricesFor(product, shoe.styleID));
    } catch (cause) {
      throw new Error(`Could not fetch Stadium Goods prices for '${shoe.styleID}'`, { cause });
    }
  },
};

export default stadiumGoodsScraper;
