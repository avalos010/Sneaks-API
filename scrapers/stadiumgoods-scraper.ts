import { load } from "cheerio";
import type { SneakerDocument } from "../models/Sneaker.js";
import http from "./http.js";

interface StadiumPrice {
  __typename?: string;
  originalValue?: { formattedValue?: string };
  value?: { formattedValue?: string };
}

interface StadiumSearchResponse {
  data?: {
    configurableProducts?: {
      edges?: { node?: { pdpUrl?: string; lowestPrice?: StadiumPrice } }[];
    };
  };
  errors?: { message?: string }[];
}

const stadiumGoodsScraper = {
  async getLink(shoe: SneakerDocument): Promise<void> {
    try {
      const response = await http.post("https://graphql.stadiumgoods.com/graphql", {
        json: {
          operationId: "sg-front/cached-a41eba558ae6325f072164477a24d3c2",
          variables: {
            categorySlug: "",
            initialSearchQuery: shoe.styleID,
            initialSort: "RELEVANCE",
            includeUnavailableProducts: null,
            filteringOnCategory: false,
            filteringOnBrand: false,
            filteringOnMensSizes: false,
            filteringOnKidsSizes: false,
            filteringOnWomensSizes: false,
            filteringOnApparelSizes: false,
            filteringOnGender: false,
            filteringOnColor: false,
            filteringOnPriceRange: false,
          },
          locale: "USA_USD",
        },
      }).json<StadiumSearchResponse>();
      if (response.errors?.length) {
        throw new Error(response.errors.map((error) => error.message ?? "GraphQL error").join("; "));
      }
      const product = response.data?.configurableProducts?.edges?.[0]?.node;
      if (!product) return;
      if (product.pdpUrl) shoe.resellLinks.stadiumGoods = product.pdpUrl;
      const lowestPrice = product.lowestPrice;
      const formattedPrice = lowestPrice?.__typename === "DiscountedPrice"
        ? lowestPrice.originalValue?.formattedValue
        : lowestPrice?.value?.formattedValue;
      if (formattedPrice) {
        const amount = Number(formattedPrice.replace(/[^0-9.-]+/g, ""));
        if (Number.isFinite(amount) && amount > 0) shoe.lowestResellPrice.stadiumGoods = amount;
      }
    } catch (cause) {
      throw new Error(`Could not search Stadium Goods for '${shoe.styleID}'`, { cause });
    }
  },

  async getPrices(shoe: SneakerDocument): Promise<void> {
    const link = shoe.resellLinks.stadiumGoods;
    if (!link) return;
    try {
      const html = await http.get(link).text();
      const $ = load(html);
      const prices: Record<string, number> = {};
      $(".product-sizes__input").each((_index, product) => {
        const input = $(product);
        if (input.attr("data-stock") !== "true") return;
        const size = input.attr("data-size");
        const rawAmount = input.attr("data-amount");
        if (!size || !rawAmount) return;
        const amount = Number(rawAmount);
        if (!Number.isFinite(amount) || amount <= 0) return;
        prices[size.replace(/W$/, "")] = amount / 100;
      });
      shoe.resellPrices.stadiumGoods = prices;
    } catch (cause) {
      throw new Error(`Could not fetch Stadium Goods prices for '${shoe.styleID}'`, { cause });
    }
  },
};

export default stadiumGoodsScraper;
