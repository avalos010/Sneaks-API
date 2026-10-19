import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import nock from "nock";
import Sneaker from "../models/Sneaker.js";
import stockX from "../scrapers/stockx-scraper.js";
import flightClub from "../scrapers/flightclub-scraper.js";
import goat from "../scrapers/goat-scraper.js";
import stadiumGoods from "../scrapers/stadiumgoods-scraper.js";

// Send explicit lengths so mocked sockets have a definite response boundary.
const provider = (origin: string) => nock(origin).replyContentLength();

const stockXSearchOrigin = "https://xw7sbct9v6-1.algolianet.com";
const algoliaOrigin = "https://2fwotdvm2o-dsn.algolia.net";

before(() => nock.disableNetConnect());
after(() => nock.enableNetConnect());
afterEach(() => {
  const pending = nock.pendingMocks();
  nock.cleanAll();
  assert.deepEqual(pending, [], "All expected provider requests should be consumed");
});

test("StockX search encodes keywords and maps only valid style IDs", async () => {
  const keyword = 'Air & Jordan "Chicago"';
  provider(stockXSearchOrigin)
    .post("/1/indexes/products/query", (body: unknown) => {
      if (typeof body !== "object" || body === null || !("params" in body) || typeof body.params !== "string") {
        return false;
      }
      const params = new URLSearchParams(body.params);
      return params.get("query") === keyword && params.get("hitsPerPage") === "2";
    })
    .query(true)
    .reply(200, {
      hits: [
        { style_id: "AA-123", name: "Air Jordan", url: "air-jordan", lowest_ask: 200,
          searchable_traits: { "Retail Price": "180" }, media: { imageUrl: "https://example.com/shoe.png" } },
        { style_id: "invalid style" },
        { name: "Missing style" },
      ],
    });

  const products = await stockX.getProductsAndInfo(keyword, 2);
  assert.equal(products.length, 1);
  const shoe = products[0];
  assert.ok(shoe);
  assert.equal(shoe.styleID, "AA-123");
  assert.equal(shoe.retailPrice, 180);
  assert.equal(shoe.resellLinks.stockX, "https://stockx.com/air-jordan");
  assert.equal(shoe.lowestResellPrice.stockX, 200);
  assert.deepEqual([...shoe.imageLinks], []);
});

test("StockX returns an empty collection for a successful empty search", async () => {
  provider(stockXSearchOrigin).post("/1/indexes/products/query").query(true).reply(200, { hits: [] });
  assert.deepEqual(await stockX.getProductsAndInfo("unknown", 1), []);
});

test("StockX preserves provider failures as contextual errors", async () => {
  provider(stockXSearchOrigin).post("/1/indexes/products/query").query(true).reply(503, { error: "unavailable" });
  await assert.rejects(stockX.getProductsAndInfo("Jordan", 1), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /Could not search StockX/);
    assert.ok(error.cause instanceof Error);
    return true;
  });
});

test("StockX price parsing strips women's suffix and skips unavailable sizes", async () => {
  const shoe = new Sneaker({ styleID: "AA-123", urlKey: "air-jordan" });
  provider("https://stockx.com").get("/api/products/air-jordan").query({ includes: "market" }).reply(200, {
    Product: { children: {
      first: { shoeSize: "8W", market: { lowestAsk: 190 } },
      second: { shoeSize: "9", market: { lowestAsk: 0 } },
      third: { shoeSize: "10" },
    } },
  });
  await stockX.getPrices(shoe);
  assert.deepEqual(shoe.resellPrices.stockX, { "8": 190 });
});

test("GOAT search maps cents, product ID and HTTPS product link", async () => {
  const shoe = new Sneaker({ styleID: "AA-123" });
  provider(algoliaOrigin).post("/1/indexes/*/queries").query(true).reply(200, {
    results: [{ hits: [{ slug: "air-jordan", lowest_price_cents_usd: 21500, product_template_id: 42 }] }],
  });
  await goat.getLink(shoe);
  assert.equal(shoe.goatProductId, 42);
  assert.equal(shoe.resellLinks.goat, "https://www.goat.com/sneakers/air-jordan");
  assert.equal(shoe.lowestResellPrice.goat, 215);
});

test("GOAT price parsing chooses the lowest new price and excludes used shoes", async () => {
  const shoe = new Sneaker({ styleID: "AA-123", goatProductId: 42,
    resellLinks: { goat: "https://www.goat.com/sneakers/air-jordan" } });
  provider("https://www.goat.com").get("/web-api/v1/product_variants/buy_bar_data")
    .query({ productTemplateId: "42" }).reply(200, [
      { shoeCondition: "new", sizeOption: { value: 8 }, lowestPriceCents: { amount: 21000 } },
      { shoeCondition: "new", sizeOption: { value: 8 }, lowestPriceCents: { amount: 19000 } },
      { shoeCondition: "used", sizeOption: { value: 8 }, lowestPriceCents: { amount: 10000 } },
      { shoeCondition: "new", sizeOption: { value: 9 } },
    ]);
  await goat.getPrices(shoe);
  assert.deepEqual(shoe.resellPrices.goat, { "8": 190 });
});

test("GOAT pictures handle missing indices and avoid duplicate images", async () => {
  const image = "https://example.com/front.png";
  const shoe = new Sneaker({ styleID: "AA-123", imageLinks: [image],
    resellLinks: { goat: "https://www.goat.com/sneakers/air-jordan" } });
  provider("https://www.goat.com").get("/web-api/v1/product_templates/air-jordan").reply(200, {
    productTemplateExternalPictures: [{ mainPictureUrl: image }, {}, { mainPictureUrl: "https://example.com/back.png" }],
  });
  await goat.getPictures(shoe);
  assert.deepEqual([...shoe.imageLinks], [image, "https://example.com/back.png"]);
});

test("Flight Club search maps description and minimum price", async () => {
  const shoe = new Sneaker({ styleID: "AA-123" });
  provider(algoliaOrigin).post("/1/indexes/*/queries").query(true).reply(200, {
    results: [{ hits: [{ slug: "air-jordan", story: "A sneaker", lowest_price_cents_usd: 19900 }] }],
  });
  await flightClub.getLink(shoe);
  assert.equal(shoe.resellLinks.flightClub, "https://www.flightclub.com/air-jordan");
  assert.equal(shoe.lowestResellPrice.flightClub, 199);
  assert.equal(shoe.description, "A sneaker");
});

test("Flight Club uses current token session and skips unavailable price options", async () => {
  const shoe = new Sneaker({ styleID: "AA-123", resellLinks: { flightClub: "https://www.flightclub.com/air-jordan" } });
  provider("https://www.flightclub.com").get("/token").reply(200, "fresh-token", {
    "set-cookie": ["session=current; Path=/; HttpOnly"],
  });
  provider("https://www.flightclub.com").post("/graphql", (body: unknown) => {
    return typeof body === "object" && body !== null && "variables" in body
      && typeof body.variables === "object" && body.variables !== null
      && "slug" in body.variables && body.variables.slug === "air-jordan";
  }).matchHeader("x-csrf-token", "fresh-token").matchHeader("cookie", "session=current").reply(200, {
    data: { getProductTemplate: { newSizes: [
      { size: { display: "8" }, lowestPriceOption: { isAvailable: true, price: { value: 21000 } } },
      { size: { display: "9" }, lowestPriceOption: { isAvailable: false, price: { value: 15000 } } },
      { size: { display: "10" }, lowestPriceOption: null },
    ] } },
  });
  await flightClub.getPrices(shoe);
  assert.deepEqual(shoe.resellPrices.flightClub, { "8": 210 });
});

test("Stadium Goods search parses a formatted minimum price", async () => {
  const shoe = new Sneaker({ styleID: "AA-123" });
  provider("https://graphql.stadiumgoods.com").post("/graphql").reply(200, {
    data: { configurableProducts: { edges: [{ node: {
      pdpUrl: "https://www.stadiumgoods.com/air-jordan",
      lowestPrice: { __typename: "Price", value: { formattedValue: "$1,200.50" } },
    } }] } },
  });
  await stadiumGoods.getLink(shoe);
  assert.equal(shoe.lowestResellPrice.stadiumGoods, 1200.5);
  assert.equal(shoe.resellLinks.stadiumGoods, "https://www.stadiumgoods.com/air-jordan");
});

test("Stadium Goods HTML parsing ignores out-of-stock and invalid sizes", async () => {
  const shoe = new Sneaker({ styleID: "AA-123", resellLinks: { stadiumGoods: "https://www.stadiumgoods.com/air-jordan" } });
  provider("https://www.stadiumgoods.com").get("/air-jordan").reply(200, `
    <input class="product-sizes__input" data-stock="true" data-size="8W" data-amount="21000">
    <input class="product-sizes__input" data-stock="false" data-size="9" data-amount="18000">
    <input class="product-sizes__input" data-stock="true" data-size="10" data-amount="invalid">
  `);
  await stadiumGoods.getPrices(shoe);
  assert.deepEqual(shoe.resellPrices.stadiumGoods, { "8": 210 });
});

test("Stadium Goods pages with no size elements complete with an empty map", async () => {
  const shoe = new Sneaker({ styleID: "AA-123", resellLinks: { stadiumGoods: "https://www.stadiumgoods.com/air-jordan" } });
  provider("https://www.stadiumgoods.com").get("/air-jordan").reply(200, "<html></html>");
  await stadiumGoods.getPrices(shoe);
  assert.deepEqual(shoe.resellPrices.stadiumGoods, {});
});

test("Optional provider operations skip shoes without product links", async () => {
  const shoe = new Sneaker({ styleID: "AA-123" });
  await Promise.all([
    stockX.getPrices(shoe), flightClub.getPrices(shoe),
    goat.getPrices(shoe), goat.getPictures(shoe), stadiumGoods.getPrices(shoe),
  ]);
});
