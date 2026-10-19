import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import nock from "nock";
import Sneaker from "../models/Sneaker.js";
import goat, { searchGoatCatalog } from "../scrapers/goat-scraper.js";
import flightClub from "../scrapers/flightclub-scraper.js";
import type { GoatCatalogHit, GoatCatalogIndex } from "../scrapers/goat-catalog.js";

const origin = "https://2fwotdvm2o-dsn.algolia.net";
const goatIndex = "product_variants_v2";
const flightIndex = "product_variants_v2_flight_club";
const product: GoatCatalogHit = {
  sku: "FY2903", name: "Yeezy Boost 350 V2 Cinder", brand_name: "adidas",
  product_template_id: 585885, slug: "yeezy-boost-350-v2-cinder-fy2903",
  shoe_condition: "new_no_defects", product_category: "shoes", has_stock: true,
  size: 8, presentation_size: "8", size_unit: "us", lowest_price_cents_usd: 18000,
  retail_price_cents_usd: 22000, silhouette: "Yeezy Boost 350", details: "Cinder/Cinder/Cinder",
  release_date: "2020-03-21T23:59:59.999Z", story_html: "<p>A <b>knit</b> &amp; Boost shoe.</p>",
  original_picture_url: "https://image.goat.com/attachments/cinder.png",
  main_picture_url: "https://image.goat.com/750/attachments/cinder.png",
  grid_picture_url: "https://image.goat.com/375/attachments/cinder.png",
};

before(() => nock.disableNetConnect());
after(() => nock.enableNetConnect());
afterEach(() => {
  const pending = nock.pendingMocks();
  nock.cleanAll();
  assert.deepEqual(pending, [], "All catalog requests should be consumed");
});

function catalog(
  index: GoatCatalogIndex,
  keyword: string,
  distinct: boolean,
  count: number,
  hits: GoatCatalogHit[],
  page = 0,
  pages = 1,
) {
  return nock(origin).replyContentLength().post("/1/indexes/*/queries", (body: unknown) => {
    if (typeof body !== "object" || body === null || !("requests" in body) || !Array.isArray(body.requests)) return false;
    const request: unknown = body.requests[0];
    if (typeof request !== "object" || request === null || !("params" in request) || typeof request.params !== "string"
      || !("indexName" in request) || request.indexName !== index) return false;
    const params = new URLSearchParams(request.params);
    return params.get("query") === keyword && params.get("distinct") === String(distinct)
      && params.get("hitsPerPage") === String(count) && params.get("page") === String(page)
      && params.get("filters") === "shoe_condition:new_no_defects AND product_category:shoes"
      && (distinct || params.get("typoTolerance") === "false");
  }).query(true).reply(200, { results: [{ hits, nbPages: pages }] });
}

test("GOAT catalog maps storefront metadata, dollars and an actual product image", async () => {
  catalog(goatIndex, "FY2903", true, 1, [product]);
  const shoes = await goat.getProductsAndInfo("FY2903", 1);
  const shoe = shoes[0];
  assert.ok(shoe);
  assert.equal(shoe.styleID, "FY2903");
  assert.equal(shoe.shoeName, product.name);
  assert.equal(shoe.retailPrice, 220);
  assert.equal(shoe.lowestResellPrice.goat, 180);
  assert.equal(shoe.brand, "adidas");
  assert.equal(shoe.silhoutte, "Yeezy Boost 350");
  assert.equal(shoe.colorway, "Cinder/Cinder/Cinder");
  assert.equal(shoe.description, "A knit & Boost shoe.");
  assert.equal(shoe.thumbnail, product.grid_picture_url);
  assert.equal(shoe.goatProductId, 585885);
  assert.equal(shoe.resellLinks.goat, "https://www.goat.com/sneakers/yeezy-boost-350-v2-cinder-fy2903");
  assert.deepEqual([...shoe.imageLinks], [product.original_picture_url]);
  await Promise.all([goat.getLink(shoe), goat.getPictures(shoe), goat.getPictures(shoe)]);
  assert.deepEqual([...shoe.imageLinks], [product.original_picture_url]);
});

test("catalog deduplicates styles and pages past malformed or used records", async () => {
  catalog(goatIndex, "yeezy", true, 2, [
    product, { ...product, sku: "fy2903" }, { ...product, sku: "USED", shoe_condition: "used" },
    { ...product, sku: "   " }, { ...product, sku: "APPAREL", product_category: "apparel" },
  ], 0, 2);
  catalog(goatIndex, "yeezy", true, 2, [{ ...product, sku: "SECOND" }], 1, 2);
  const shoes = await searchGoatCatalog("yeezy", 2);
  assert.deepEqual(shoes.map((shoe) => shoe.styleID), ["FY2903", "SECOND"]);
});

test("successful empty catalog searches return empty arrays", async () => {
  catalog(goatIndex, "unknown", true, 3, []);
  assert.deepEqual(await goat.getProductsAndInfo("unknown", 3), []);
});

test("catalog normalizes supplier SKU spaces and matches hyphenated price lookups", async () => {
  const nike = { ...product, sku: " HQ7978 001 " };
  catalog(goatIndex, "Jordan", true, 1, [nike]);
  const shoes = await goat.getProductsAndInfo("Jordan", 1);
  const shoe = shoes[0];
  assert.ok(shoe);
  assert.equal(shoe.styleID, "HQ7978-001");
  catalog(goatIndex, "HQ7978-001", false, 100, [nike]);
  await goat.getPrices(shoe);
  assert.deepEqual(shoe.resellPrices.goat, { "8": 180 });
});

test("catalog rejects invalid counts and preserves upstream response failures", async () => {
  for (const count of [0, -1, 101, 1.5, Number.NaN]) {
    await assert.rejects(searchGoatCatalog("shoe", count), RangeError);
  }
  nock(origin).replyContentLength().post("/1/indexes/*/queries").query(true)
    .reply(200, { results: [{ message: "Invalid index", status: 404 }] });
  await assert.rejects(goat.getProductsAndInfo("shoe", 1), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /Could not search GOAT/);
    assert.ok(error.cause instanceof Error);
    assert.match(error.cause.message, /Invalid index/);
    return true;
  });
});

test("GOAT per-size catalog prices exclude other SKUs, used and unavailable variants", async () => {
  catalog(goatIndex, "fy2903", false, 100, [
    product, { ...product, lowest_price_cents_usd: 17000 },
    { ...product, sku: "FY2904", lowest_price_cents_usd: 100 },
    { ...product, size: 9, shoe_condition: "used", lowest_price_cents_usd: 100 },
    { ...product, size: 10, has_stock: false },
    { ...product, size: 11, lowest_price_cents_usd: 0 },
    { ...product, size: 12, size_unit: "eu" },
  ], 0, 2);
  catalog(goatIndex, "fy2903", false, 100, [{ ...product, size: 9, lowest_price_cents_usd: 19500 }], 1, 2);
  const shoe = new Sneaker({ styleID: "fy2903" });
  await goat.getLink(shoe);
  await Promise.all([goat.getPrices(shoe), goat.getPictures(shoe)]);
  assert.deepEqual(shoe.resellPrices.goat, { "8": 170, "9": 195 });
  assert.equal(shoe.lowestResellPrice.goat, 170);
  assert.deepEqual([...shoe.imageLinks], [product.original_picture_url]);
});

test("GOAT catalog picture fallback adds only the image actually supplied", async () => {
  catalog(goatIndex, "FY2903", false, 100, [{ ...product, original_picture_url: null }]);
  const shoe = new Sneaker({ styleID: "FY2903", resellLinks: { goat: "https://www.goat.com/sneakers/cinder" } });
  await goat.getPictures(shoe);
  await goat.getPictures(shoe);
  assert.deepEqual([...shoe.imageLinks], [product.main_picture_url]);
});

test("Flight Club gets links and size prices directly from its public catalog", async () => {
  catalog(flightIndex, "FY2903", false, 100, [
    { ...product, story: "Flight Club description", lowest_price_cents_usd: 19900 },
    { ...product, size: 9, lowest_price_cents_usd: 21500 },
    { ...product, size: 9, lowest_price_cents_usd: 20500 },
    { ...product, size: 10, shoe_condition: "used", lowest_price_cents_usd: 100 },
    { ...product, sku: "FY2904", lowest_price_cents_usd: 100 },
  ]);
  const shoe = new Sneaker({ styleID: "FY2903" });
  await flightClub.getLink(shoe);
  await flightClub.getPrices(shoe);
  assert.equal(shoe.description, "Flight Club description");
  assert.equal(shoe.lowestResellPrice.flightClub, 199);
  assert.equal(shoe.resellLinks.flightClub, "https://www.flightclub.com/yeezy-boost-350-v2-cinder-fy2903");
  assert.deepEqual(shoe.resellPrices.flightClub, { "8": 199, "9": 205 });
});

test("exact SKU lookup does not attach a similarly named catalog product", async () => {
  const providers: { index: GoatCatalogIndex; scraper: Pick<typeof goat, "getLink"> }[] = [
    { index: goatIndex, scraper: goat }, { index: flightIndex, scraper: flightClub },
  ];
  for (const { index, scraper } of providers) {
    catalog(index, "FY2903", false, 100, [{ ...product, sku: "FY2904" }]);
    const shoe = new Sneaker({ styleID: "FY2903" });
    await scraper.getLink(shoe);
    assert.equal(shoe.resellLinks.goat, undefined);
    assert.equal(shoe.resellLinks.flightClub, undefined);
  }
});

test("failed catalog enrichment can be retried without replaying a rejected cache entry", async () => {
  nock(origin).replyContentLength().post("/1/indexes/*/queries").query(true).reply(503, { error: "Unavailable" });
  const shoe = new Sneaker({ styleID: "FY2903" });
  await assert.rejects(flightClub.getLink(shoe), /Could not search Flight Club/);
  catalog(flightIndex, "FY2903", false, 100, [product]);
  await flightClub.getLink(shoe);
  assert.ok(shoe.resellLinks.flightClub);
});
