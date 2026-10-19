import assert from "node:assert/strict";
import { globalAgent } from "node:https";
import { after, afterEach, before, test } from "node:test";
import nock from "nock";
import Sneaker from "../models/Sneaker.js";
import stadiumGoods from "../scrapers/stadiumgoods-scraper.js";

const origin = "https://www.stadiumgoods.com";
const handle = "jordan-1-retro-high-mcs-chicago-125290";
const provider = () => nock(origin).replyContentLength();

function product(sku = "125290|AV5354 611|9") {
  return {
    options: [{ name: "Size", position: 1 }],
    variants: [{ sku, available: true, price: 14700, options: ["9"] }],
  };
}

function search(handles: string[]) {
  return provider().get("/search/suggest.json").query({
    q: "AV5354 611",
    "resources[type]": "product",
    "resources[limit]": "10",
    "resources[options][unavailable_products]": "show",
  }).reply(200, { resources: { results: { products: handles.map((entry) => ({ handle: entry })) } } });
}

before(() => nock.disableNetConnect());
after(() => nock.enableNetConnect());
afterEach(() => {
  const pending = nock.pendingMocks();
  nock.cleanAll();
  globalAgent.destroy();
  assert.deepEqual(pending, [], "Expected Stadium Goods requests should be consumed");
});

test("Stadium Goods uses the current Shopify search and product endpoints", async () => {
  const shoe = new Sneaker({ styleID: "AV5354-611" });
  search([handle]);
  provider().get(`/products/${handle}.js`).reply(200, product());
  await stadiumGoods.getLink(shoe);
  assert.equal(shoe.resellLinks.stadiumGoods, `${origin}/products/${handle}`);
  assert.equal(shoe.lowestResellPrice.stadiumGoods, 147);
  assert.deepEqual(shoe.resellPrices.stadiumGoods, { "9": 147 });
});

test("Stadium Goods skips fuzzy results until manufacturer SKU matches exactly", async () => {
  const shoe = new Sneaker({ styleID: "AV5354-611" });
  search(["wrong-shoe", handle]);
  provider().get("/products/wrong-shoe.js").reply(200, product("125290|AV5354 610|9"));
  provider().get(`/products/${handle}.js`).reply(200, product());
  await stadiumGoods.getLink(shoe);
  assert.equal(shoe.resellLinks.stadiumGoods, `${origin}/products/${handle}`);
});

test("Stadium Goods empty search returns without linking a shoe", async () => {
  const shoe = new Sneaker({ styleID: "AV5354-611" });
  search([]);
  await stadiumGoods.getLink(shoe);
  assert.equal(shoe.resellLinks.stadiumGoods, undefined);
});

test("Stadium Goods malformed search responses remain provider failures", async () => {
  const shoe = new Sneaker({ styleID: "AV5354-611" });
  provider().get("/search/suggest.json").query(true).reply(200, { errors: ["bad search"] });
  await assert.rejects(stadiumGoods.getLink(shoe), /Could not search Stadium Goods/);
});

test("Stadium Goods reads the size option, excludes unavailable variants and chooses lowest size price", async () => {
  const shoe = new Sneaker({ styleID: "AV5354-611", resellLinks: { stadiumGoods: `${origin}/products/${handle}?variant=42` } });
  provider().get(`/products/${handle}.js`).reply(200, {
    options: [{ name: "Condition", position: 1 }, { name: "Size", position: 2 }],
    variants: [
      { sku: "125290|AV5354 611|8", available: true, price: 21000, options: ["New", "8W"] },
      { sku: "125290|AV5354 611|8", available: true, price: 19500, options: ["New", "8W"] },
      { sku: "125290|AV5354 611|9", available: false, price: 10000, options: ["New", "9"] },
      { sku: "125290|AV5354 611|10", available: true, price: -2000, options: ["New", "10"] },
      { sku: "125290|OTHER STYLE|11", available: true, price: 8000, options: ["New", "11"] },
    ],
  });
  await stadiumGoods.getPrices(shoe);
  assert.deepEqual(shoe.resellPrices.stadiumGoods, { "8": 195 });
  assert.equal(shoe.lowestResellPrice.stadiumGoods, 195);
});

test("Stadium Goods sold-out products clear stale prices", async () => {
  const shoe = new Sneaker({ styleID: "AV5354-611", resellLinks: { stadiumGoods: `${origin}/products/${handle}` },
    lowestResellPrice: { stadiumGoods: 147 }, resellPrices: { stadiumGoods: { "9": 147 } } });
  const value = product();
  const variant = value.variants[0];
  assert.ok(variant);
  variant.available = false;
  provider().get(`/products/${handle}.js`).reply(200, value);
  await stadiumGoods.getPrices(shoe);
  assert.deepEqual(shoe.resellPrices.stadiumGoods, {});
  assert.equal(shoe.lowestResellPrice.stadiumGoods, undefined);
});

test("Stadium Goods rejects a product URL that maps to a different style", async () => {
  const shoe = new Sneaker({ styleID: "AV5354-611", resellLinks: { stadiumGoods: `${origin}/products/${handle}` } });
  provider().get(`/products/${handle}.js`).reply(200, product("125290|AV5354 610|9"));
  await assert.rejects(stadiumGoods.getPrices(shoe), /Could not fetch Stadium Goods prices/);
});

test("Stadium Goods does not turn storefront access errors into empty results", async () => {
  const shoe = new Sneaker({ styleID: "AV5354-611" });
  provider().get("/search/suggest.json").query(true).reply(403, "Access denied");
  await assert.rejects(stadiumGoods.getLink(shoe), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /Could not search Stadium Goods/);
    assert.ok(error.cause instanceof Error);
    return true;
  });
});
