import Sneaker, { type SneakerDocument } from "../models/Sneaker.js";
import http from "./http.js";

interface StockXProduct {
  style_id?: string;
  name?: string;
  brand?: string;
  make?: string;
  colorway?: string;
  searchable_traits?: { "Retail Price"?: number | string };
  media?: { imageUrl?: string };
  release_date?: string;
  description?: string;
  url?: string;
  lowest_ask?: number;
}

interface StockXSearchResponse {
  hits?: StockXProduct[];
}

interface StockXPriceResponse {
  Product?: {
    children?: Record<string, {
      shoeSize?: string;
      market?: { lowestAsk?: number };
    }>;
  };
}

const stockXScraper = {
  async getProductsAndInfo(key: string, count: number): Promise<SneakerDocument[]> {
    try {
      const params = new URLSearchParams({
        query: key,
        facets: "*",
        filters: "",
        hitsPerPage: String(count),
      });
      const response = await http.post(
        "https://xw7sbct9v6-1.algolianet.com/1/indexes/products/query",
        {
          searchParams: {
            "x-algolia-application-id": "XW7SBCT9V6",
            "x-algolia-api-key": "6b5e76b49705eb9f51a06d3c82f7acee",
          },
          json: { params: params.toString() },
        },
      ).json<StockXSearchResponse>();

      const products: SneakerDocument[] = [];
      for (const product of response.hits ?? []) {
        if (!product.style_id || /\s/.test(product.style_id)) continue;
        const retailPrice = Number(product.searchable_traits?.["Retail Price"]);
        const shoe = new Sneaker({
          shoeName: product.name,
          brand: product.brand,
          silhoutte: product.make,
          styleID: product.style_id,
          make: product.make,
          colorway: product.colorway,
          retailPrice: Number.isFinite(retailPrice) ? retailPrice : undefined,
          thumbnail: product.media?.imageUrl,
          releaseDate: product.release_date,
          description: product.description,
          urlKey: product.url,
          resellLinks: product.url ? { stockX: `https://stockx.com/${product.url}` } : {},
        });
        if (product.lowest_ask !== undefined && Number.isFinite(product.lowest_ask) && product.lowest_ask > 0) {
          shoe.lowestResellPrice.stockX = product.lowest_ask;
        }
        products.push(shoe);
      }
      return products;
    } catch (cause) {
      throw new Error(`Could not search StockX for '${key}'`, { cause });
    }
  },

  async getPrices(shoe: SneakerDocument): Promise<void> {
    if (!shoe.urlKey) return;
    try {
      const response = await http.get(
        `https://stockx.com/api/products/${encodeURIComponent(shoe.urlKey)}`,
        { searchParams: { includes: "market" } },
      ).json<StockXPriceResponse>();
      const prices: Record<string, number> = {};
      for (const variant of Object.values(response.Product?.children ?? {})) {
        const price = variant.market?.lowestAsk;
        if (!variant.shoeSize || price === undefined || !Number.isFinite(price) || price <= 0) continue;
        prices[variant.shoeSize.replace(/W$/, "")] = price;
      }
      shoe.resellPrices.stockX = prices;
    } catch (cause) {
      throw new Error(`Could not fetch StockX prices for '${shoe.styleID}'`, { cause });
    }
  },
};

export default stockXScraper;
