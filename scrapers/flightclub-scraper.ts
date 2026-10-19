import type { SneakerDocument } from "../models/Sneaker.js";
import { getCatalogVariants, type GoatCatalogHit } from "./goat-catalog.js";
import { getFlightClubStorefrontPrices } from "./goat-storefront.js";

const variants = new WeakMap<SneakerDocument, Promise<GoatCatalogHit[]>>();

function loadVariants(shoe: SneakerDocument): Promise<GoatCatalogHit[]> {
  const existing = variants.get(shoe);
  if (existing) return existing;
  const operation = getCatalogVariants("product_variants_v2_flight_club", shoe.styleID).catch((cause: unknown) => {
    variants.delete(shoe);
    throw new Error(`Could not search Flight Club for '${shoe.styleID}'`, { cause });
  });
  variants.set(shoe, operation);
  return operation;
}

const flightClubScraper = {
  async getLink(shoe: SneakerDocument): Promise<void> {
    const products = await loadVariants(shoe);
    const product = products[0];
    if (!product) return;
    if (product.slug) shoe.resellLinks.flightClub = `https://www.flightclub.com/${encodeURIComponent(product.slug)}`;
    if (product.story) shoe.description = product.story;
  },

  async getPrices(shoe: SneakerDocument): Promise<void> {
    const link = shoe.resellLinks.flightClub;
    if (!link) return;
    shoe.resellPrices.flightClub = {};
    shoe.set("lowestResellPrice.flightClub", undefined);
    shoe.resellPrices.flightClub = await getFlightClubStorefrontPrices(link, shoe.styleID);
    const prices = Object.values(shoe.resellPrices.flightClub);
    if (prices.length) shoe.lowestResellPrice.flightClub = Math.min(...prices);
  },
};

export default flightClubScraper;
