import type { SneakerDocument } from "../models/Sneaker.js";
import http from "./http.js";

interface GoatSearchResponse {
  results?: { hits?: {
    lowest_price_cents_usd?: number;
    slug?: string;
    product_template_id?: number;
  }[] }[];
}

interface GoatVariant {
  shoeCondition?: string;
  sizeOption?: { value?: string | number };
  lowestPriceCents?: { amount?: number };
}

interface GoatPicturesResponse {
  productTemplateExternalPictures?: { mainPictureUrl?: string }[];
}

const goatScraper = {
  async getLink(shoe: SneakerDocument): Promise<void> {
    try {
      const params = new URLSearchParams({
        distinct: "true",
        maxValuesPerFacet: "1",
        page: "0",
        query: shoe.styleID,
        facets: JSON.stringify(["instant_ship_lowest_price_cents"]),
      });
      const response = await http.post(
        "https://2fwotdvm2o-dsn.algolia.net/1/indexes/*/queries",
        {
          searchParams: {
            "x-algolia-application-id": "2FWOTDVM2O",
            "x-algolia-api-key": "ac96de6fef0e02bb95d433d8d5c7038a",
          },
          json: { requests: [{ indexName: "product_variants_v2", params: params.toString() }] },
        },
      ).json<GoatSearchResponse>();
      const product = response.results?.[0]?.hits?.[0];
      if (!product) return;
      if (product.lowest_price_cents_usd !== undefined && Number.isFinite(product.lowest_price_cents_usd) && product.lowest_price_cents_usd > 0) {
        shoe.lowestResellPrice.goat = product.lowest_price_cents_usd / 100;
      }
      if (product.slug) shoe.resellLinks.goat = `https://www.goat.com/sneakers/${product.slug}`;
      if (product.product_template_id !== undefined) shoe.goatProductId = product.product_template_id;
    } catch (cause) {
      throw new Error(`Could not search GOAT for '${shoe.styleID}'`, { cause });
    }
  },

  async getPrices(shoe: SneakerDocument): Promise<void> {
    if (!shoe.resellLinks.goat || shoe.goatProductId === undefined) return;
    try {
      const variants = await http.get(
        "https://www.goat.com/web-api/v1/product_variants/buy_bar_data",
        { searchParams: { productTemplateId: shoe.goatProductId } },
      ).json<GoatVariant[]>();
      const prices: Record<string, number> = {};
      for (const variant of variants) {
        if (variant.shoeCondition === "used") continue;
        const size = variant.sizeOption?.value;
        const amount = variant.lowestPriceCents?.amount;
        if (size === undefined || amount === undefined || !Number.isFinite(amount) || amount <= 0) continue;
        const key = String(size);
        const previous = prices[key];
        prices[key] = previous === undefined ? amount / 100 : Math.min(previous, amount / 100);
      }
      shoe.resellPrices.goat = prices;
    } catch (cause) {
      throw new Error(`Could not fetch GOAT prices for '${shoe.styleID}'`, { cause });
    }
  },

  async getPictures(shoe: SneakerDocument): Promise<void> {
    const link = shoe.resellLinks.goat;
    if (!link) return;
    try {
      const response = await http.get(
        link.replace("/sneakers/", "/web-api/v1/product_templates/"),
      ).json<GoatPicturesResponse>();
      for (const index of [0, 2, 5, 7, 3]) {
        const url = response.productTemplateExternalPictures?.[index]?.mainPictureUrl;
        if (url && !shoe.imageLinks.includes(url)) shoe.imageLinks.push(url);
      }
    } catch (cause) {
      throw new Error(`Could not fetch GOAT pictures for '${shoe.styleID}'`, { cause });
    }
  },
};

export default goatScraper;
