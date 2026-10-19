import { load } from "cheerio";
import Sneaker, { type SneakerDocument } from "../models/Sneaker.js";
import {
  getCatalogVariants, isNewShoe, normalizeStyleID, queryGoatCatalog, usd, type GoatCatalogHit,
} from "./goat-catalog.js";
import { getGoatStorefrontPrices } from "./goat-storefront.js";

const metadata = new WeakMap<SneakerDocument, GoatCatalogHit>();
const variants = new WeakMap<SneakerDocument, Promise<GoatCatalogHit[]>>();

function applyProduct(shoe: SneakerDocument, product: GoatCatalogHit): void {
  metadata.set(shoe, product);
  if (product.slug) shoe.resellLinks.goat = `https://www.goat.com/sneakers/${encodeURIComponent(product.slug)}`;
  if (typeof product.product_template_id === "number") shoe.goatProductId = product.product_template_id;
  const image = product.original_picture_url || product.main_picture_url;
  if (image && !shoe.imageLinks.includes(image)) shoe.imageLinks.push(image);
}

function loadVariants(shoe: SneakerDocument): Promise<GoatCatalogHit[]> {
  const existing = variants.get(shoe);
  if (existing) return existing;
  const operation = getCatalogVariants("product_variants_v2", shoe.styleID).catch((cause: unknown) => {
    variants.delete(shoe);
    throw new Error(`Could not search GOAT for '${shoe.styleID}'`, { cause });
  });
  variants.set(shoe, operation);
  return operation;
}

export async function searchGoatCatalog(keyword: string, count = 40): Promise<SneakerDocument[]> {
  if (!Number.isInteger(count) || count < 1 || count > 100) {
    throw new RangeError("count must be an integer between 1 and 100");
  }
  try {
    const products: SneakerDocument[] = [];
    const styles = new Set<string>();
    for (let page = 0; page < 5 && products.length < count; page += 1) {
      const result = await queryGoatCatalog("product_variants_v2", keyword, count, true, page);
      for (const hit of result.hits) {
        const styleID = hit.sku ? normalizeStyleID(hit.sku) : "";
        if (!isNewShoe(hit) || !styleID || styles.has(styleID)) continue;
        styles.add(styleID);
        const shoe = new Sneaker({
          styleID,
          shoeName: hit.name,
          brand: hit.brand_name,
          silhoutte: hit.silhouette,
          make: hit.silhouette,
          colorway: hit.details,
          releaseDate: hit.release_date,
          retailPrice: usd(hit.retail_price_cents_usd),
          thumbnail: hit.grid_picture_url || hit.main_picture_url || hit.original_picture_url,
          description: hit.story || (hit.story_html ? load(hit.story_html).text().trim() : undefined),
        });
        applyProduct(shoe, hit);
        products.push(shoe);
        if (products.length === count) break;
      }
      if (page + 1 >= result.pages || result.hits.length === 0) break;
    }
    return products;
  } catch (cause) {
    throw new Error(`Could not search GOAT for '${keyword}'`, { cause });
  }
}

const goatScraper = {
  getProductsAndInfo: searchGoatCatalog,

  async getLink(shoe: SneakerDocument): Promise<void> {
    if (metadata.has(shoe)) return;
    const products = await loadVariants(shoe);
    const product = products[0];
    if (product) applyProduct(shoe, product);
  },

  async getPrices(shoe: SneakerDocument): Promise<void> {
    const link = shoe.resellLinks.goat;
    if (!link || shoe.goatProductId === undefined) return;
    shoe.resellPrices.goat = {};
    shoe.set("lowestResellPrice.goat", undefined);
    shoe.resellPrices.goat = await getGoatStorefrontPrices(link, shoe.goatProductId);
    const prices = Object.values(shoe.resellPrices.goat);
    if (prices.length) shoe.lowestResellPrice.goat = Math.min(...prices);
  },

  async getPictures(shoe: SneakerDocument): Promise<void> {
    if (!shoe.resellLinks.goat) return;
    const product = metadata.get(shoe) ?? (await loadVariants(shoe))[0];
    if (product) applyProduct(shoe, product);
  },
};

export default goatScraper;
