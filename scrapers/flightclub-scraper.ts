import type { SneakerDocument } from "../models/Sneaker.js";
import http from "./http.js";

interface FlightClubSearchResponse {
  results?: { hits?: {
    lowest_price_cents_usd?: number;
    slug?: string;
    story?: string;
  }[] }[];
}

interface FlightClubPricesResponse {
  data?: {
    getProductTemplate?: {
      newSizes?: {
        size?: { display?: string };
        lowestPriceOption?: {
          isAvailable?: boolean;
          price?: { value?: number };
        };
      }[];
    };
  };
  errors?: { message?: string }[];
}

const productQuery = `
  query getProductTemplate($slug: String!) {
    getProductTemplate(slug: $slug) {
      newSizes {
        size { display }
        lowestPriceOption { price { value } isAvailable }
      }
    }
  }
`;

const flightClubScraper = {
  async getLink(shoe: SneakerDocument): Promise<void> {
    try {
      const params = new URLSearchParams({
        query: shoe.styleID,
        hitsPerPage: "1",
        maxValuesPerFacet: "1",
        filters: "",
        facets: JSON.stringify(["lowest_price_cents_usd"]),
        tagFilters: "",
      });
      const response = await http.post(
        "https://2fwotdvm2o-dsn.algolia.net/1/indexes/*/queries",
        {
          searchParams: {
            "x-algolia-application-id": "2FWOTDVM2O",
            "x-algolia-api-key": "ac96de6fef0e02bb95d433d8d5c7038a",
          },
          json: { requests: [{ indexName: "product_variants_v2_flight_club", params: params.toString() }] },
        },
      ).json<FlightClubSearchResponse>();
      const product = response.results?.[0]?.hits?.[0];
      if (!product) return;
      if (product.lowest_price_cents_usd !== undefined && Number.isFinite(product.lowest_price_cents_usd) && product.lowest_price_cents_usd > 0) {
        shoe.lowestResellPrice.flightClub = product.lowest_price_cents_usd / 100;
      }
      if (product.slug) shoe.resellLinks.flightClub = `https://www.flightclub.com/${product.slug}`;
      if (product.story) shoe.description = product.story;
    } catch (cause) {
      throw new Error(`Could not search Flight Club for '${shoe.styleID}'`, { cause });
    }
  },

  async getPrices(shoe: SneakerDocument): Promise<void> {
    const link = shoe.resellLinks.flightClub;
    if (!link) return;
    try {
      const slug = new URL(link).pathname.replace(/^\//, "");
      const tokenResponse = await http.get("https://www.flightclub.com/token");
      // Reuse the current session supplied with the token, never a stored cookie.
      const cookies = tokenResponse.headers["set-cookie"]
        ?.map((cookie) => cookie.split(";")[0])
        .filter((cookie): cookie is string => Boolean(cookie))
        .join("; ");
      const headers: Record<string, string> = { "x-csrf-token": tokenResponse.body.trim() };
      if (cookies) headers.cookie = cookies;
      const response = await http.post("https://www.flightclub.com/graphql", {
        headers,
        json: {
          operationName: "getProductTemplate",
          variables: { slug },
          query: productQuery,
        },
      }).json<FlightClubPricesResponse>();
      if (response.errors?.length) {
        throw new Error(response.errors.map((error) => error.message ?? "GraphQL error").join("; "));
      }
      const prices: Record<string, number> = {};
      for (const variant of response.data?.getProductTemplate?.newSizes ?? []) {
        const size = variant.size?.display;
        const option = variant.lowestPriceOption;
        const amount = option?.price?.value;
        if (!size || option?.isAvailable === false || amount === undefined || !Number.isFinite(amount) || amount <= 0) continue;
        const previous = prices[size];
        prices[size] = previous === undefined ? amount / 100 : Math.min(previous, amount / 100);
      }
      shoe.resellPrices.flightClub = prices;
    } catch (cause) {
      throw new Error(`Could not fetch Flight Club prices for '${shoe.styleID}'`, { cause });
    }
  },
};

export default flightClubScraper;
