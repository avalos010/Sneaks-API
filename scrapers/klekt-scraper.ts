import { load } from "cheerio";
import type { PriceMap, SneakerDocument } from "../models/Sneaker.js";
import http from "./http.js";

const origin = "https://klekt.com";
const normalize = (value: string): string => value.replace(/[^a-z0-9]/gi, "").toUpperCase();

/** A search is fuzzy; every candidate must be confirmed against its listing. */
export function parseKlektListing(html: string, styleID: string): { size: string; price: number } | undefined {
  const $ = load(html);
  const details = new Map<string, string>();
  $("li").each((_index, element) => {
    const children = $(element).children("span");
    if (children.length === 2) details.set(children.first().text().trim(), children.last().text().trim());
  });
  if (normalize(details.get("SKU") ?? "") !== normalize(styleID)
    || details.get("Condition") !== "Deadstock / New"
    || details.get("Includes") !== "Original Box") return undefined;
  const size = /^US\s+(?:W\s*)?(\d+(?:\.\d+)?)$/i.exec(details.get("Size") ?? "")?.[1];
  if (!size) return undefined;
  for (const element of $('script[type="application/ld+json"]').toArray()) {
    let data: unknown;
    try { data = JSON.parse($(element).text()); } catch { continue; }
    if (typeof data !== "object" || data === null || !("sku" in data) || typeof data.sku !== "string"
      || normalize(data.sku) !== normalize(styleID) || !("offers" in data)
      || typeof data.offers !== "object" || data.offers === null) continue;
    const offer = data.offers;
    if (!("priceCurrency" in offer) || offer.priceCurrency !== "USD" || !("price" in offer)
      || !("availability" in offer) || offer.availability !== "https://schema.org/InStock") continue;
    const price = Number(offer.price);
    if (Number.isFinite(price) && price > 0) return { size, price };
  }
  return undefined;
}

const klektScraper = {
  async getPrices(shoe: SneakerDocument): Promise<void> {
    try {
      const searchURL = new URL("/catalog", origin);
      searchURL.searchParams.set("search", shoe.styleID);
      const html = await http.get(searchURL.href).text();
      const $ = load(html);
      if (!$('input[value]').toArray().some((input) => $(input).attr("value") === shoe.styleID)) {
        throw new Error("KLEKT did not return a searchable listings page");
      }
      const urls = [...new Set($("a[href^='/listing/']").map((_index, element) => $(element).attr("href")).get())]
        .filter((href) => /^\/listing\/[a-z0-9-]+$/i.test(href)).slice(0, 12);
      const prices: PriceMap = {};
      let failed = false;
      for (let offset = 0; offset < urls.length; offset += 4) {
        const results = await Promise.allSettled(urls.slice(offset, offset + 4).map(async (path) => {
          const listing = await http.get(new URL(path, origin).href).text();
          return parseKlektListing(listing, shoe.styleID);
        }));
        for (const result of results) {
          if (result.status === "rejected") { failed = true; continue; }
          if (!result.value) continue;
          const { size, price } = result.value;
          prices[size] = Math.min(prices[size] ?? price, price);
        }
      }
      shoe.resellPrices.klekt = prices;
      const amounts = Object.values(prices);
      if (amounts.length) {
        shoe.lowestResellPrice.klekt = Math.min(...amounts);
        shoe.resellLinks.klekt = searchURL.href;
      }
      if (failed) throw new Error("Some KLEKT listings could not be checked");
    } catch (cause) {
      throw new Error(`Could not fetch KLEKT prices for '${shoe.styleID}'`, { cause });
    }
  },
};

export default klektScraper;
