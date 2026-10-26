import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import SneaksAPI, { ProductNotFoundError } from "../controllers/sneaks.controllers.js";
import Sneaker, { type SneakerDocument } from "../models/Sneaker.js";
import stockXScraper from "../scrapers/stockx-scraper.js";
import flightClubScraper from "../scrapers/flightclub-scraper.js";
import stadiumGoodsScraper from "../scrapers/stadiumgoods-scraper.js";
import goatScraper from "../scrapers/goat-scraper.js";
import { handler } from "../index.js";

function mockEnrichment(context: TestContext): void {
  for (const scraper of [flightClubScraper, stadiumGoodsScraper, goatScraper]) {
    context.mock.method(scraper, "getLink", async () => {});
    context.mock.method(scraper, "getPrices", async () => {});
  }
  context.mock.method(stockXScraper, "getPrices", async () => {});
  context.mock.method(goatScraper, "getPictures", async () => {});
}

test("empty searches resolve and invoke callbacks once", async (context) => {
  const search = context.mock.method(goatScraper, "getProductsAndInfo", async () => []);
  const api = new SneaksAPI();
  assert.deepEqual(await api.getProducts("missing"), []);
  let calls = 0;
  await api.getProducts("missing", 40, (error, products) => {
    calls += 1;
    assert.equal(error, null);
    assert.deepEqual(products, []);
  });
  assert.equal(calls, 1);
  assert.deepEqual(search.mock.calls[0]?.arguments, ["missing", 40]);
});

test("provider errors reject promises and reach callbacks once", async (context) => {
  const failure = new Error("Catalog unavailable");
  context.mock.method(goatScraper, "getProductsAndInfo", async () => { throw failure; });
  const api = new SneaksAPI();
  await assert.rejects(api.getProducts("shoe"), failure);
  let calls = 0;
  await api.getProducts("shoe", 3, (error, products) => {
    calls += 1;
    assert.equal(error, failure);
    assert.equal(products, null);
  });
  assert.equal(calls, 1);
});

test("optional link failures preserve products and other enrichment", async (context) => {
  mockEnrichment(context);
  const shoe = new Sneaker({ styleID: "ABC-123", resellLinks: { goat: "https://www.goat.com/sneakers/abc-123" } });
  context.mock.method(goatScraper, "getProductsAndInfo", async () => [shoe]);
  context.mock.method(flightClubScraper, "getLink", async () => { throw new Error("Unavailable"); });
  const products = await new SneaksAPI().getProducts("shoe", 1);
  assert.equal(products[0], shoe);
  assert.equal(shoe.resellLinks.goat, "https://www.goat.com/sneakers/abc-123");
  assert.equal(shoe.providerErrors[0]?.provider, "flightClub");
  assert.equal(shoe.providerErrors[0]?.message, "Unavailable");
});

test("search returns prices from every provider and preserves partial results", async (context) => {
  mockEnrichment(context);
  context.mock.method(goatScraper, "getProductsAndInfo", async () => [new Sneaker({ styleID: "ABC-123" })]);
  for (const [provider, scraper] of [["goat", goatScraper], ["flightClub", flightClubScraper],
    ["stadiumGoods", stadiumGoodsScraper], ["stockX", stockXScraper]] as const) {
    context.mock.method(scraper, "getPrices", async (shoe: SneakerDocument) => {
      if (provider === "stockX") throw new Error("Unavailable");
      shoe.resellPrices[provider] = { "9": 125 };
    });
  }
  const [shoe] = await new SneaksAPI().getProducts("nike", 1);
  assert.ok(shoe);
  for (const provider of ["goat", "flightClub", "stadiumGoods"] as const) {
    assert.equal(shoe.resellPrices[provider]?.["9"], 125);
  }
  assert.equal(shoe.providerErrors.find((error) => error.provider === "stockX")?.operation, "prices");
});

test("prices and pictures work without StockX developer credentials", async (context) => {
  mockEnrichment(context);
  const shoe = new Sneaker({ styleID: "ABC-123" });
  context.mock.method(goatScraper, "getProductsAndInfo", async () => [shoe]);
  const stockXPrices = context.mock.method(stockXScraper, "getPrices", async () => {
    throw new Error("Unavailable");
  });
  const stadiumPrices = context.mock.method(stadiumGoodsScraper, "getPrices", async () => {});
  const flightPrices = context.mock.method(flightClubScraper, "getPrices", async () => {});
  const goatPrices = context.mock.method(goatScraper, "getPrices", async (product: SneakerDocument) => {
    product.resellPrices.goat = { "9": 125 };
  });
  const pictures = context.mock.method(goatScraper, "getPictures", async (product: SneakerDocument) => {
    product.imageLinks.push("https://example.com/shoe.jpg");
  });
  const api = new SneaksAPI();
  assert.equal(await api.getProductPrices("abc-123"), shoe);
  assert.equal(shoe.resellPrices.goat?.["9"], 125);
  assert.deepEqual(Array.from(shoe.imageLinks), ["https://example.com/shoe.jpg"]);
  assert.equal(stockXPrices.mock.callCount(), 1);
  assert.equal(shoe.providerErrors.find((error) => error.provider === "stockX")?.operation, "prices");
  for (const operation of [stadiumPrices, flightPrices, goatPrices, pictures]) {
    assert.equal(operation.mock.callCount(), 1);
  }
  let calls = 0;
  await api.getProductPrices("ABC-123", (error, result) => {
    calls += 1;
    assert.equal(error, null);
    assert.equal(result?.styleID, shoe.styleID);
    assert.equal(result?.resellPrices.goat?.["9"], 125);
  });
  assert.equal(calls, 1);
});

test("empty and mismatched product lookups report missing products", async (context) => {
  mockEnrichment(context);
  const api = new SneaksAPI();
  const search = context.mock.method(goatScraper, "getProductsAndInfo", async () => []);
  await assert.rejects(api.getProductPrices("missing"), ProductNotFoundError);
  let calls = 0;
  await api.getProductPrices("missing", (error, product) => {
    calls += 1;
    assert.ok(error instanceof ProductNotFoundError);
    assert.equal(product, null);
  });
  assert.equal(calls, 1);
  search.mock.restore();
  context.mock.method(goatScraper, "getProductsAndInfo", async () => [new Sneaker({ styleID: "OTHER" })]);
  await assert.rejects(api.getProductPrices("requested"), ProductNotFoundError);
});

test("a failed pricing provider is reported while other size prices remain available", async (context) => {
  mockEnrichment(context);
  const shoe = new Sneaker({ styleID: "ABC-123" });
  context.mock.method(goatScraper, "getProductsAndInfo", async () => [shoe]);
  context.mock.method(flightClubScraper, "getPrices", async () => {
    throw new Error("Flight Club unavailable");
  });
  context.mock.method(goatScraper, "getPrices", async (product: SneakerDocument) => {
    product.resellPrices.goat = { "9": 125 };
  });
  const product = await new SneaksAPI().getProductPrices("ABC-123");
  assert.equal(product.resellPrices.goat?.["9"], 125);
  const failure = product.providerErrors.find((error) => error.provider === "flightClub");
  assert.equal(failure?.operation, "prices");
  assert.equal(failure?.message, "Flight Club unavailable");
});

test("consumer callback exceptions reject without invoking callbacks again", async (context) => {
  context.mock.method(goatScraper, "getProductsAndInfo", async () => []);
  const failure = new Error("Consumer callback failed");
  let calls = 0;
  await assert.rejects(new SneaksAPI().getProducts("shoe", 1, () => {
    calls += 1;
    throw failure;
  }), failure);
  assert.equal(calls, 1);
});

test("popular products use the empty keyword with promise and callback APIs", async (context) => {
  const search = context.mock.method(goatScraper, "getProductsAndInfo", async () => []);
  const api = new SneaksAPI();
  assert.deepEqual(await api.getMostPopular(), []);
  assert.deepEqual(search.mock.calls[0]?.arguments, ["", 40]);
  await api.getMostPopular(12, (error, products) => {
    assert.equal(error, null);
    assert.deepEqual(products, []);
  });
  assert.deepEqual(search.mock.calls[1]?.arguments, ["", 12]);
});

async function request(path: string, query: Record<string, string> = {}) {
  const response: unknown = await handler({
    httpMethod: "GET",
    path,
    headers: { host: "localhost", origin: "https://example.com" },
    queryStringParameters: query,
    requestContext: { identity: { sourceIp: "127.0.0.1" } },
    body: null,
    isBase64Encoded: false,
  }, {});
  assert.ok(typeof response === "object" && response !== null);
  assert.ok("statusCode" in response && typeof response.statusCode === "number");
  assert.ok("body" in response && typeof response.body === "string");
  assert.ok("headers" in response && typeof response.headers === "object" && response.headers !== null);
  return { status: response.statusCode, body: response.body, headers: response.headers };
}

test("serverless root and Netlify-prefixed routes respond with CORS", async () => {
  for (const path of ["/", "/.netlify/functions/api/"]) {
    const response = await request(path);
    assert.equal(response.status, 200);
    assert.equal(response.body, "Hello World");
    assert.ok("access-control-allow-origin" in response.headers);
    assert.equal(response.headers["access-control-allow-origin"], "*");
  }
});

test("serverless search and popular routes apply default and explicit counts", async (context) => {
  const search = context.mock.method(goatScraper, "getProductsAndInfo", async () => []);
  let response = await request("/search/jordan");
  assert.equal(response.status, 200);
  assert.equal(response.body, "[]");
  assert.deepEqual(search.mock.calls[0]?.arguments, ["jordan", 40]);
  response = await request("/.netlify/functions/api/popular", { count: "100" });
  assert.equal(response.status, 200);
  assert.deepEqual(search.mock.calls[1]?.arguments, ["", 100]);
});

test("catalog-only search returns promptly without price enrichment", async (context) => {
  const shoe = new Sneaker({ styleID: "CATALOG-123" });
  context.mock.method(goatScraper, "getProductsAndInfo", async () => [shoe]);
  const prices = context.mock.method(stockXScraper, "getPrices", async () => {});
  const response = await request("/search/catalog-test", { catalog: "true", count: "1" });
  assert.equal(response.status, 200);
  assert.equal(JSON.parse(response.body)[0].styleID, "CATALOG-123");
  assert.equal(prices.mock.callCount(), 0);
});

test("invalid route counts return 400 before searching", async (context) => {
  const search = context.mock.method(goatScraper, "getProductsAndInfo", async () => []);
  for (const count of ["0", "-1", "101", "1.5", "two", "", "1e2", "9007199254740992"]) {
    for (const path of ["/popular", "/.netlify/functions/api/search/jordan"]) {
      const response = await request(path, { count });
      assert.equal(response.status, 400, `${path}?count=${count}`);
      assert.match(response.body, /count must be an integer between 1 and 100/);
    }
  }
  assert.equal(search.mock.callCount(), 0);
});

test("missing product routes return 404 and provider failures return 502", async (context) => {
  context.mock.method(goatScraper, "getProductsAndInfo", async () => []);
  let response = await request("/.netlify/functions/api/id/ABC-123/prices");
  assert.equal(response.status, 404);
  assert.equal(response.body, JSON.stringify({ error: "Product Not Found" }));
  context.mock.method(goatScraper, "getProductsAndInfo", async () => { throw new Error("Upstream unavailable"); });
  for (const path of ["/search/unavailable", "/popular", "/id/UNAVAILABLE/prices"]) {
    response = await request(path);
    assert.equal(response.status, 502);
    assert.match(response.body, /Unable to retrieve products from the provider/);
    assert.doesNotMatch(response.body, /Upstream unavailable/);
  }
});
