import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";
import nock from "nock";
import Sneaker from "../models/Sneaker.js";
import stockX from "../scrapers/stockx-scraper.js";
import browser from "../scrapers/stockx-browser.js";

const origin = "https://stockx.com";
const productUrl = `${origin}/adidas-yeezy-boost-350-v2-cinder`;
const provider = () => nock(origin).replyContentLength().defaultReplyHeaders({ connection: "close" });

// Minimal fixtures follow markup observed on the ordinary StockX storefront.
// Direct HTTP requests from this environment still receive a verification 403.
const product = (extra: Record<string, unknown> = {}) => ({
  "@type": "Product", sku: "f33dca85-0dd3-46a9-aec9-352f54fbbac1", name: "adidas Yeezy Boost 350 V2 Cinder",
  url: productUrl, brand: { name: "adidas" }, color: "Cinder/Cinder/Cinder",
  image: ["https://images.example/cinder.jpg"], ...extra,
});
const html = (value: unknown, styleID = "FY2903") => `<html>
  <title>adidas Yeezy Boost 350 V2 Cinder Men's - ${styleID} - US</title>
  <div data-component="product-trait"><span>Style</span><p>${styleID}</p></div>
  <div data-component="product-trait"><span>Retail Price</span><p>$220</p></div>
  <script type="application/ld+json">${JSON.stringify(value)}</script></html>`;
const searchHtml = (...urls: string[]) => `<div id="product-results">${urls.map((url) =>
  `<div data-testid="ProductTile"><a href="${url}" aria-label="Cinder"></a></div>`).join("")}</div>`;

before(() => nock.disableNetConnect());
beforeEach((context) => {
  assert.ok("mock" in context);
  context.mock.method(browser, "getPage", async () => {
    throw new Error("Public browser unavailable in this test");
  });
});
after(() => nock.enableNetConnect());
afterEach(() => {
  const pending = nock.pendingMocks();
  nock.cleanAll();
  assert.deepEqual(pending, [], "All expected public StockX requests should be consumed");
});

test("StockX public search follows observed product tiles and reads the actual style instead of JSON-LD UUIDs", async () => {
  const query = 'Yeezy & Cinder "black"';
  provider().get("/search").query({ s: query }).reply(200, searchHtml(
    productUrl, productUrl, `${productUrl}?sponsored=true`,
  ));
  provider().get("/adidas-yeezy-boost-350-v2-cinder").reply(200, html(product()));
  const shoes = await stockX.getProductsAndInfo(query, 10);
  assert.equal(shoes.length, 1);
  const shoe = shoes[0];
  assert.ok(shoe);
  assert.equal(shoe.styleID, "FY2903");
  assert.equal(shoe.brand, "adidas");
  assert.equal(shoe.colorway, "Cinder/Cinder/Cinder");
  assert.equal(shoe.resellLinks.stockX, productUrl);
  assert.equal(shoe.retailPrice, 220);
  assert.equal(shoe.thumbnail, "https://images.example/cinder.jpg");
});

test("StockX public offers retain only available new USD size prices", async () => {
  const shoe = new Sneaker({ styleID: "FY2903", resellLinks: { stockX: productUrl } });
  provider().get("/adidas-yeezy-boost-350-v2-cinder").reply(200, html(product({ offers: [
    { "@type": "Offer", price: "190.50", priceCurrency: "USD", description: "8W" },
    { "@type": "Offer", price: 180, priceCurrency: "USD", description: "8W" },
    { "@type": "Offer", price: 100, priceCurrency: "USD", availability: "https://schema.org/OutOfStock", description: "9" },
    { "@type": "Offer", price: 90, priceCurrency: "USD", itemCondition: "https://schema.org/UsedCondition", description: "10" },
    { "@type": "Offer", price: 85, priceCurrency: "EUR", description: "11" },
  ] })));
  await stockX.getPrices(shoe);
  assert.deepEqual(shoe.resellPrices.stockX, { "8": 180 });
  assert.equal(shoe.lowestResellPrice.stockX, 180);
  assert.deepEqual([...shoe.imageLinks], ["https://images.example/cinder.jpg"]);
});

test("StockX aggregate offers do not fabricate size prices", async () => {
  const shoe = new Sneaker({ styleID: "FY2903", resellLinks: { stockX: productUrl } });
  provider().get("/adidas-yeezy-boost-350-v2-cinder").reply(200, html(product({
    offers: { "@type": "AggregateOffer", lowPrice: "112", priceCurrency: "USD" },
  })));
  await stockX.getPrices(shoe);
  assert.equal(shoe.lowestResellPrice.stockX, 112);
  assert.deepEqual(shoe.resellPrices.stockX, {});
});

test("StockX reads the observed AggregateOffer nesting and numeric description sizes", async () => {
  const shoe = new Sneaker({ styleID: "FY2903", resellLinks: { stockX: productUrl } });
  // Values and field layout observed on the public Cinder product page.
  provider().get("/adidas-yeezy-boost-350-v2-cinder").reply(200, html(product({
    offers: {
      "@type": "AggregateOffer", lowPrice: 112, highPrice: 560, priceCurrency: "USD",
      offers: [{ "@type": "Offer", description: "4", price: 153, priceCurrency: "USD",
        availability: "https://schema.org/InStock" }],
    },
  })));
  await stockX.getPrices(shoe);
  assert.equal(shoe.lowestResellPrice.stockX, 112);
  assert.deepEqual(shoe.resellPrices.stockX, { "4": 153 });
});

test("StockX resolves an actual public product link by exact style instead of reusing a GOAT slug", async () => {
  const shoe = new Sneaker({ styleID: "FY2903", urlKey: "a-goat-only-slug" });
  provider().get("/search").query({ s: "FY2903" }).reply(200, searchHtml("/wrong-shoe", productUrl));
  provider().get("/wrong-shoe").reply(200, html(product({ url: `${origin}/wrong-shoe` }), "OTHER"));
  provider().get("/adidas-yeezy-boost-350-v2-cinder").reply(200, html(product({
    offers: { "@type": "Offer", price: 200, priceCurrency: "USD" },
  })));
  await stockX.getPrices(shoe);
  assert.equal(shoe.resellLinks.stockX, productUrl);
  assert.equal(shoe.lowestResellPrice.stockX, 200);
});

test("StockX reports HTTP blocks and the actionable browser failure without attempting authenticated APIs", async (context) => {
  const failure = new Error("Install Google Chrome or set CHROME_EXECUTABLE_PATH");
  context.mock.method(browser, "getPage", async () => { throw failure; });
  provider().get("/search").query({ s: "FY2903" }).reply(403, "Please login to continue");
  await assert.rejects(stockX.getProductsAndInfo("FY2903", 1), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /StockX browser fallback failed after HTTP 403.*Install Google Chrome/);
    assert.equal(error.cause, failure);
    return true;
  });
  const shoe = new Sneaker({ styleID: "FY2903", resellLinks: { stockX: productUrl } });
  provider().get("/adidas-yeezy-boost-350-v2-cinder").reply(429, "Too many requests");
  await assert.rejects(stockX.getPrices(shoe), /HTTP 429/);
});

test("StockX falls back for login pages and missing public data without inventing a Next.js contract", async () => {
  provider().get("/search").query({ s: "FY2903" })
    .reply(200, "<html>Please log in to verify you are not a bot</html>");
  await assert.rejects(stockX.getProductsAndInfo("FY2903", 1), /bot-verification login page/);
  provider().get("/search").query({ s: "FY2903" }).reply(200, "<html>No embedded product data</html>");
  await assert.rejects(stockX.getProductsAndInfo("FY2903", 1), /public HTML omitted search data/);
});

test("StockX refuses to assign prices when product identity or currency does not match", async () => {
  const shoe = new Sneaker({ styleID: "FY2903", resellLinks: { stockX: productUrl } });
  provider().get("/adidas-yeezy-boost-350-v2-cinder").reply(200, html(product(), "OTHER"));
  await assert.rejects(stockX.getPrices(shoe), /did not match style/);
  provider().get("/adidas-yeezy-boost-350-v2-cinder").reply(200, html(product({
    offers: { "@type": "Offer", price: 120, priceCurrency: "EUR" },
  })));
  await assert.rejects(stockX.getPrices(shoe), /did not expose available USD offers/);
  assert.equal(shoe.lowestResellPrice.stockX, undefined);
});

test("StockX ignores non-StockX product links exposed by structured data", async () => {
  provider().get("/search").query({ s: "FY2903" }).reply(200, searchHtml("https://other.example/shoe"));
  const shoes = await stockX.getProductsAndInfo("FY2903", 1);
  assert.deepEqual(shoes, []);
});

test("StockX rejects a UUID sku when neither transport exposes a real style identifier", async (context) => {
  const shoe = new Sneaker({ styleID: "FY2903", resellLinks: { stockX: productUrl } });
  const noStyle = `<html><script type="application/ld+json">${JSON.stringify(product())}</script></html>`;
  provider().get("/adidas-yeezy-boost-350-v2-cinder").reply(200, noStyle);
  context.mock.method(browser, "getPage", async () => noStyle);
  await assert.rejects(stockX.getPrices(shoe), /browser did not expose public product data/);
});

test("StockX uses rendered browser product HTML after a direct HTTP 403", async (context) => {
  const rendered = html(product({ offers: {
    "@type": "AggregateOffer", lowPrice: 112, priceCurrency: "USD",
    offers: [{ "@type": "Offer", description: "4", price: 153, priceCurrency: "USD" }],
  } }));
  const fallback = context.mock.method(browser, "getPage", async () => rendered);
  provider().get("/adidas-yeezy-boost-350-v2-cinder").reply(403, "Please login to continue");
  const shoe = new Sneaker({ styleID: "FY2903", resellLinks: { stockX: productUrl } });
  await stockX.getPrices(shoe);
  assert.deepEqual(fallback.mock.calls[0]?.arguments, [productUrl]);
  assert.equal(fallback.mock.callCount(), 1);
  assert.equal(shoe.lowestResellPrice.stockX, 112);
  assert.deepEqual(shoe.resellPrices.stockX, { "4": 153 });
});

test("StockX uses browser search results after HTTP 403 and keeps complete product HTTP responses", async (context) => {
  const fallback = context.mock.method(browser, "getPage", async () => searchHtml(productUrl));
  provider().get("/search").query({ s: "FY2903" }).reply(403, "Please login to continue");
  provider().get("/adidas-yeezy-boost-350-v2-cinder").reply(200, html(product()));
  const shoes = await stockX.getProductsAndInfo("FY2903", 1);
  assert.equal(shoes[0]?.styleID, "FY2903");
  assert.deepEqual(fallback.mock.calls[0]?.arguments, [`${origin}/search?s=FY2903`]);
  assert.equal(fallback.mock.callCount(), 1);
});

test("StockX renders an incomplete HTTP 200 product page before reading prices", async (context) => {
  const fallback = context.mock.method(browser, "getPage", async () => html(product({
    offers: { "@type": "AggregateOffer", lowPrice: 112, priceCurrency: "USD" },
  })));
  provider().get("/adidas-yeezy-boost-350-v2-cinder").reply(200, "<html><div id=\"__next\"></div></html>");
  const shoe = new Sneaker({ styleID: "FY2903", resellLinks: { stockX: productUrl } });
  await stockX.getPrices(shoe);
  assert.equal(fallback.mock.callCount(), 1);
  assert.equal(shoe.lowestResellPrice.stockX, 112);
});
