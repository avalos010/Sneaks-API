import { load } from "cheerio";
import type { PriceMap } from "../models/Sneaker.js";
import { normalizeStyleID, usd } from "./goat-catalog.js";
import http from "./http.js";
import browser from "./stockx-browser.js";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numericSize(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return String(value);
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value)) return undefined;
  const size = Number(value);
  return Number.isFinite(size) && size > 0 ? String(size) : undefined;
}

function putPrice(prices: PriceMap, size: string, price: number): void {
  const previous = prices[size];
  prices[size] = previous === undefined ? price : Math.min(previous, price);
}

/** Current public buy-bar data, matching Buy New with a good original box. */
export function parseGoatPrices(value: unknown): PriceMap {
  if (!Array.isArray(value)) throw new Error("GOAT returned an invalid buy-bar response");
  const prices: PriceMap = {};
  for (const variant of value) {
    if (!record(variant)) throw new Error("GOAT returned an invalid variant");
    if (variant.shoeCondition !== "new_no_defects" || variant.boxCondition !== "good_condition"
      || variant.stockStatus === "not_in_stock") continue;
    const option = record(variant.sizeOption) ? variant.sizeOption : undefined;
    const size = numericSize(option?.value);
    const amount = record(variant.lowestPriceCents) ? variant.lowestPriceCents : undefined;
    if (amount?.currency !== "USD") {
      if (typeof amount?.amount === "number" && amount.amount > 0) {
        throw new Error("GOAT buy-bar prices are not in USD");
      }
      continue;
    }
    const price = usd(typeof amount.amount === "number" ? amount.amount : undefined);
    if (size && price !== undefined) putPrice(prices, size, price);
  }
  return prices;
}

/** Read the same regional size options rendered by Flight Club's product page. */
export function parseFlightClubPrices(html: string, styleID: string): PriceMap {
  const source = load(html)("script#__NEXT_DATA__").text();
  if (!source) throw new Error("Flight Club page is missing its public product data");
  const data: unknown = JSON.parse(source);
  const props = record(data) && record(data.props) ? data.props : undefined;
  const page = props && record(props.pageProps) ? props.pageProps : undefined;
  const region = page && record(page.shoppingRegionData) ? page.shoppingRegionData : undefined;
  if (region?.country !== "US" || (region.currencyCode ?? region.currency) !== "USD") {
    throw new Error("Flight Club prices must use the United States shopping region and USD");
  }
  const product = page && record(page.productTemplate) ? page.productTemplate : undefined;
  if (!product || typeof product.sku !== "string" || normalizeStyleID(product.sku) !== normalizeStyleID(styleID)) {
    throw new Error("Flight Club returned a different manufacturer style ID");
  }
  if (product.sizeUnit !== "us") throw new Error("Flight Club product sizes are not US sizes");
  if (!Array.isArray(product.newSizes)) throw new Error("Flight Club returned invalid current size prices");
  const prices: PriceMap = {};
  for (const variant of product.newSizes) {
    if (!record(variant)) throw new Error("Flight Club returned an invalid size variant");
    if (variant.boxCondition !== "good_condition" || variant.shoeCondition !== "new_no_defects"
      || variant.isInstantShip === true || variant.productTemplateId !== product.id) continue;
    const option = record(variant.lowestPriceOption) ? variant.lowestPriceOption : undefined;
    const amount = option && record(option.price) ? option.price : undefined;
    const sizeValue = record(variant.size) ? variant.size : undefined;
    const size = numericSize(sizeValue?.value);
    const price = usd(typeof amount?.localizedValue === "number" ? amount.localizedValue
      : typeof amount?.value === "number" ? amount.value : undefined);
    if (option?.isAvailable === true && size && price !== undefined) putPrice(prices, size, price);
  }
  return prices;
}

export async function getGoatStorefrontPrices(productURL: string, templateId: number): Promise<PriceMap> {
  let payload: unknown;
  try {
    payload = await http.get("https://www.goat.com/web-api/v1/product_variants/buy_bar_data", {
      searchParams: { productTemplateId: templateId, countryCode: "US" },
    }).json<unknown>();
  } catch {
    payload = await browser.getGoatPrices(productURL, templateId);
  }
  return parseGoatPrices(payload);
}

export async function getFlightClubStorefrontPrices(productURL: string, styleID: string): Promise<PriceMap> {
  let html: string;
  try {
    html = await http.get(productURL).text();
    return parseFlightClubPrices(html, styleID);
  } catch {
    html = await browser.getFlightClubPage(productURL);
  }
  return parseFlightClubPrices(html, styleID);
}
