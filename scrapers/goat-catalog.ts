import http from "./http.js";

export type GoatCatalogIndex = "product_variants_v2" | "product_variants_v2_flight_club";

/** Fields observed in the public storefront's per-size catalog records. */
export interface GoatCatalogHit {
  sku?: string | null;
  name?: string | null;
  brand_name?: string | null;
  silhouette?: string | null;
  details?: string | null;
  release_date?: string | null;
  retail_price_cents_usd?: number | null;
  lowest_price_cents_usd?: number | null;
  slug?: string | null;
  product_template_id?: number | null;
  shoe_condition?: string | null;
  product_category?: string | null;
  has_stock?: boolean | null;
  size?: number | null;
  presentation_size?: string | null;
  size_unit?: string | null;
  original_picture_url?: string | null;
  main_picture_url?: string | null;
  grid_picture_url?: string | null;
  story?: string | null;
  story_html?: string | null;
}

interface CatalogResponse {
  results?: {
    hits?: GoatCatalogHit[];
    nbPages?: number;
    message?: string;
    status?: number;
  }[];
}

export async function queryGoatCatalog(
  index: GoatCatalogIndex,
  keyword: string,
  count: number,
  distinct: boolean,
  page = 0,
): Promise<{ hits: GoatCatalogHit[]; pages: number }> {
  const params = new URLSearchParams({
    query: keyword,
    hitsPerPage: String(count),
    distinct: String(distinct),
    page: String(page),
    filters: "shoe_condition:new_no_defects AND product_category:shoes",
  });
  if (!distinct) params.set("typoTolerance", "false");
  const response = await http.post(
    "https://2fwotdvm2o-dsn.algolia.net/1/indexes/*/queries",
    {
      searchParams: {
        "x-algolia-application-id": "2FWOTDVM2O",
        "x-algolia-api-key": "ac96de6fef0e02bb95d433d8d5c7038a",
      },
      json: { requests: [{ indexName: index, params: params.toString() }] },
    },
  ).json<CatalogResponse>();
  const result = response.results?.[0];
  if (!result || !Array.isArray(result.hits)) {
    throw new Error(result?.message ?? "The storefront catalog returned an invalid response");
  }
  return {
    hits: result.hits,
    pages: Number.isInteger(result.nbPages) && (result.nbPages ?? 0) > 0 ? result.nbPages ?? 1 : 1,
  };
}

export function isNewShoe(hit: GoatCatalogHit): boolean {
  return hit.shoe_condition === "new_no_defects" && hit.product_category === "shoes";
}

export function usd(cents: number | null | undefined): number | undefined {
  return typeof cents === "number" && Number.isFinite(cents) && cents > 0 ? cents / 100 : undefined;
}

/** GOAT separates many Nike SKU components with spaces rather than hyphens. */
export function normalizeStyleID(styleID: string): string {
  return styleID.trim().replace(/\s+/g, "-").toUpperCase();
}

export async function getCatalogVariants(index: GoatCatalogIndex, styleID: string): Promise<GoatCatalogHit[]> {
  const hits: GoatCatalogHit[] = [];
  // Bound pagination even if the provider returns an unexpectedly large page count.
  for (let page = 0; page < 5; page += 1) {
    const result = await queryGoatCatalog(index, styleID, 100, false, page);
    hits.push(...result.hits.filter((hit) =>
      isNewShoe(hit) && typeof hit.sku === "string" && normalizeStyleID(hit.sku) === normalizeStyleID(styleID),
    ));
    if (page + 1 >= result.pages || result.hits.length === 0) break;
  }
  return hits;
}

export function catalogPrices(hits: GoatCatalogHit[]): Record<string, number> {
  const prices: Record<string, number> = {};
  for (const hit of hits) {
    const price = usd(hit.lowest_price_cents_usd);
    if (!isNewShoe(hit) || hit.has_stock === false || price === undefined) continue;
    const size = typeof hit.size === "number" && Number.isFinite(hit.size) && hit.size > 0
      ? String(hit.size)
      : hit.presentation_size;
    if (!size || (hit.size_unit && hit.size_unit !== "us")) continue;
    const previous = prices[size];
    prices[size] = previous === undefined ? price : Math.min(previous, price);
  }
  return prices;
}
