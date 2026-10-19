import { load } from "cheerio";
import Sneaker, { type SneakerDocument } from "../models/Sneaker.js";
import http from "./http.js";
import browser from "./stockx-browser.js";

const origin = "https://stockx.com";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function positiveAmount(value: unknown): number | undefined {
  if ((typeof value !== "number" && typeof value !== "string") || value === "") return undefined;
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : undefined;
}

function stockXUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const url = new URL(value, origin);
    if (url.protocol !== "https:" || url.hostname !== "stockx.com" || url.username || url.password || url.port) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

function isType(value: unknown, type: string): boolean {
  const types: unknown[] = Array.isArray(value) ? value : [value];
  return types.some((entry) => typeof entry === "string" && entry.replace(/^https?:\/\/schema\.org\//, "") === type);
}

function normalizeStyleID(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toUpperCase();
}

interface ProductDetails {
  styleID?: string;
  retailPrice?: number;
}

function pageDetails(html: string): ProductDetails {
  const $ = load(html);
  const details: ProductDetails = {};
  $('[data-component="product-trait"]').each((_index, element) => {
    const label = $(element).find("span").first().text().trim();
    const value = $(element).find("p").first().text().trim();
    if (label === "Style" && value && !/\s/.test(value)) details.styleID = value;
    if (label === "Retail Price" && /^\$[\d,.]+$/.test(value)) {
      details.retailPrice = positiveAmount(value.replace(/[$,]/g, ""));
    }
  });
  if (!details.styleID) {
    const title = $("title").text();
    const match = / - ([a-z0-9][a-z0-9./-]*) - US$/i.exec(title);
    details.styleID = match?.[1];
  }
  return details;
}

type PublicPageKind = "search" | "product";

function isVerificationPage(html: string): boolean {
  return /please log(?:\s|<[^>]+>)*in to verify you are not a bot/i.test(html);
}

function hasPublicData(html: string, kind: PublicPageKind): boolean {
  if (isVerificationPage(html)) return false;
  if (kind === "search") return load(html)("#product-results").length > 0;
  if (!pageDetails(html).styleID) return false;
  try {
    return productData(html).length > 0;
  } catch {
    return false;
  }
}

async function browserPage(url: string, kind: PublicPageKind, reason: string): Promise<string> {
  try {
    const html = await browser.getPage(url);
    if (!hasPublicData(html, kind)) {
      throw new Error(`The browser did not expose public ${kind} data; StockX may require verification or the storefront format may have changed`);
    }
    return html;
  } catch (cause: unknown) {
    const detail = cause instanceof Error ? cause.message : "Browser navigation failed";
    throw new Error(`StockX browser fallback failed after ${reason}: ${detail}`, { cause });
  }
}

async function publicPage(url: string, kind: PublicPageKind): Promise<string> {
  const response = await http.get(url, { throwHttpErrors: false });
  if (response.statusCode === 403 || response.statusCode === 429) {
    return browserPage(url, kind, `HTTP ${response.statusCode}`);
  }
  if (response.statusCode !== 200) {
    throw new Error(`StockX public page request failed (HTTP ${response.statusCode})`);
  }
  if (!hasPublicData(response.body, kind)) {
    const reason = isVerificationPage(response.body)
      ? "a bot-verification login page"
      : `the public HTML omitted ${kind} data`;
    return browserPage(url, kind, reason);
  }
  return response.body;
}

function collectProducts(value: unknown, products: Record<string, unknown>[], depth = 0): void {
  if (depth > 20) return;
  if (Array.isArray(value)) {
    for (const entry of value) collectProducts(entry, products, depth + 1);
  } else if (record(value)) {
    if (isType(value["@type"], "Product")) products.push(value);
    for (const entry of Object.values(value)) collectProducts(entry, products, depth + 1);
  }
}

function productData(html: string): Record<string, unknown>[] {
  const $ = load(html);
  const products: Record<string, unknown>[] = [];
  // Parse the JSON-LD rendered on the ordinary public product page.
  $('script[type="application/ld+json"]').each((_index, element) => {
    try {
      const value: unknown = JSON.parse($(element).text());
      collectProducts(value, products);
    } catch {
      // A malformed unrelated JSON-LD block must not hide valid Product blocks.
    }
  });
  if (products.length === 0) {
    throw new Error("StockX public page did not expose supported Product JSON-LD; access may be blocked or the storefront format may have changed");
  }
  return products;
}

function searchProductUrls(html: string): string[] {
  const $ = load(html);
  if ($("#product-results").length === 0) {
    throw new Error("StockX public search did not expose its product results; access may be blocked or the storefront format may have changed");
  }
  const urls = new Set<string>();
  $('#product-results [data-testid="ProductTile"] a[href]').each((_index, element) => {
    const value = stockXUrl($(element).attr("href"));
    if (!value) return;
    const url = new URL(value);
    if (url.searchParams.get("sponsored") === "true") return;
    url.search = "";
    url.hash = "";
    urls.add(url.href);
  });
  return [...urls];
}

async function searchUrls(key: string): Promise<string[]> {
  const url = new URL("/search", origin);
  url.searchParams.set("s", key);
  return searchProductUrls(await publicPage(url.href, "search"));
}

function sizeLabel(value: unknown): string | undefined {
  return text(value) ?? (record(value) ? text(value.name) : undefined);
}

function pricesFromOffers(value: unknown, inheritedSize?: string): { prices: Record<string, number>; minimum?: number } {
  const prices: Record<string, number> = {};
  const amounts: number[] = [];
  const visit = (entry: unknown, depth = 0): void => {
    if (depth > 10) return;
    if (Array.isArray(entry)) {
      for (const offer of entry) visit(offer, depth + 1);
      return;
    }
    if (!record(entry)) return;
    if (typeof entry.availability === "string" && /(?:OutOfStock|SoldOut|Discontinued)$/.test(entry.availability)) return;
    if (typeof entry.itemCondition === "string" && /UsedCondition$/.test(entry.itemCondition)) return;
    const specification = record(entry.priceSpecification) ? entry.priceSpecification : undefined;
    const currency = entry.priceCurrency ?? specification?.priceCurrency;
    if (currency === "USD") {
      const amount = positiveAmount(entry.price ?? specification?.price ?? entry.lowPrice);
      if (amount !== undefined) {
        amounts.push(amount);
        const offered = record(entry.itemOffered) ? entry.itemOffered : undefined;
        // The current public StockX Product JSON-LD uses Offer.description as
        // the size label and Offer.sku as a variant UUID, not a sneaker style.
        const description = text(entry.description);
        const describedSize = description && /^\d+(?:\.\d+)?W?$/.test(description) ? description : undefined;
        const size = sizeLabel(offered?.size) ?? inheritedSize ?? describedSize;
        if (size && !isType(entry["@type"], "AggregateOffer")) {
          const key = size.replace(/W$/, "");
          const previous = prices[key];
          prices[key] = previous === undefined ? amount : Math.min(previous, amount);
        }
      }
    }
    if (entry.offers !== undefined) visit(entry.offers, depth + 1);
  };
  visit(value);
  return { prices, minimum: amounts.length > 0 ? Math.min(...amounts) : undefined };
}

function toSneaker(product: Record<string, unknown>, details: ProductDetails, fallbackUrl?: string): SneakerDocument | undefined {
  // StockX's public Product.sku is a UUID. Read the real style from the visible
  // product details (or the observed US page-title format), never from that UUID.
  const styleID = details.styleID;
  if (!styleID || /\s/.test(styleID)) return undefined;
  const brand = record(product.brand) ? text(product.brand.name) : text(product.brand);
  const images: unknown[] = Array.isArray(product.image) ? product.image : [product.image];
  const imageLinks = images.flatMap((image) => {
    const url = text(image) ?? (record(image) ? text(image.contentUrl) ?? text(image.url) : undefined);
    return url ? [url] : [];
  });
  const url = stockXUrl(product.url) ?? fallbackUrl;
  const { prices, minimum } = pricesFromOffers(product.offers, sizeLabel(product.size));
  return new Sneaker({
    styleID,
    shoeName: text(product.name),
    brand,
    retailPrice: details.retailPrice,
    colorway: text(product.color),
    description: text(product.description),
    releaseDate: text(product.releaseDate),
    imageLinks,
    thumbnail: imageLinks[0],
    urlKey: url ? new URL(url).pathname.slice(1) : undefined,
    resellLinks: url ? { stockX: url } : {},
    lowestResellPrice: minimum === undefined ? {} : { stockX: minimum },
    resellPrices: { stockX: prices },
  });
}

const stockXScraper = {
  async getProductsAndInfo(key: string, count: number): Promise<SneakerDocument[]> {
    if (!Number.isInteger(count) || count < 1 || count > 100) {
      throw new Error("StockX result count must be an integer between 1 and 100");
    }
    const urls = await searchUrls(key);
    const shoes: SneakerDocument[] = [];
    const seen = new Set<string>();
    for (const productUrl of urls) {
      const html = await publicPage(productUrl, "product");
      const details = pageDetails(html);
      const pageProducts = productData(html);
      const matchingProduct = pageProducts.find((entry) => stockXUrl(entry.url) === productUrl)
        ?? pageProducts[0];
      const shoe = matchingProduct ? toSneaker(matchingProduct, details, productUrl) : undefined;
      if (!shoe || seen.has(shoe.styleID)) continue;
      seen.add(shoe.styleID);
      shoes.push(shoe);
      if (shoes.length === count) break;
    }
    return shoes;
  },

  async getPrices(shoe: SneakerDocument): Promise<void> {
    let url = stockXUrl(shoe.resellLinks.stockX);
    let html: string | undefined;
    if (!url) {
      // Discover an actual StockX link by style ID; a GOAT slug is not a StockX URL.
      for (const candidateUrl of await searchUrls(shoe.styleID)) {
        const candidateHtml = await publicPage(candidateUrl, "product");
        const details = pageDetails(candidateHtml);
        if (details.styleID && normalizeStyleID(details.styleID) === normalizeStyleID(shoe.styleID)) {
          url = candidateUrl;
          html = candidateHtml;
          break;
        }
      }
      if (!url) throw new Error(`StockX public search did not expose a product link for style '${shoe.styleID}'`);
    }
    html ??= await publicPage(url, "product");
    const details = pageDetails(html);
    const products = productData(html);
    const matchingProduct = products.find((entry) => stockXUrl(entry.url) === url) ?? products[0];
    const product = matchingProduct ? toSneaker(matchingProduct, details, url) : undefined;
    if (!product || normalizeStyleID(product.styleID) !== normalizeStyleID(shoe.styleID)) {
      throw new Error(`StockX public page did not match style '${shoe.styleID}'`);
    }
    const minimum = product.lowestResellPrice.stockX;
    if (minimum === undefined) throw new Error("StockX public product data did not expose available USD offers");
    shoe.resellLinks.stockX = url;
    shoe.lowestResellPrice.stockX = minimum;
    shoe.resellPrices.stockX = product.resellPrices.stockX ?? {};
    for (const image of product.imageLinks) {
      if (!shoe.imageLinks.includes(image)) shoe.imageLinks.push(image);
    }
  },
};

export default stockXScraper;
