import type { SneakerDocument } from "../models/Sneaker.js";
import { catalogPrices, getCatalogVariants, usd, type GoatCatalogHit } from "./goat-catalog.js";

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
    const prices = Object.values(catalogPrices(products));
    const price = prices.length ? Math.min(...prices) : usd(product.lowest_price_cents_usd);
    if (price !== undefined && product.has_stock !== false) shoe.lowestResellPrice.flightClub = price;
  },

  async getPrices(shoe: SneakerDocument): Promise<void> {
    if (!shoe.resellLinks.flightClub) return;
    shoe.resellPrices.flightClub = catalogPrices(await loadVariants(shoe));
  },
};

export default flightClubScraper;
