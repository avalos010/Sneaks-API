import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import SneaksAPI from "../controllers/sneaks.controllers.js";
import { RequestCache } from "../controllers/request-cache.js";
import Sneaker, { type SneakerDocument } from "../models/Sneaker.js";
import goat from "../scrapers/goat-scraper.js";
import flightClub from "../scrapers/flightclub-scraper.js";
import stadiumGoods from "../scrapers/stadiumgoods-scraper.js";
import stockX from "../scrapers/stockx-scraper.js";

function deferred<T>() {
  let settle: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => { settle = resolve; });
  return {
    promise,
    resolve(value: T): void {
      assert.ok(settle);
      settle(value);
    },
  };
}

function mockEnrichment(context: TestContext): void {
  for (const scraper of [flightClub, stadiumGoods]) {
    context.mock.method(scraper, "getLink", async () => {});
    context.mock.method(scraper, "getPrices", async () => {});
  }
  context.mock.method(stockX, "getPrices", async () => {});
  context.mock.method(goat, "getPrices", async () => {});
  context.mock.method(goat, "getPictures", async () => {});
}

test("cache shares concurrent loads, isolates mutable values, and expires from completion", async () => {
  let now = 0;
  let calls = 0;
  const response = deferred<{ value: number }>();
  const cache = new RequestCache<{ value: number }>({
    enabled: true, ttlMs: 50, maxEntries: 2, now: () => now,
    clone: (value) => ({ ...value }), isCacheable: () => true,
  });
  const load = () => {
    calls += 1;
    return response.promise;
  };
  const first = cache.get("shoe", load).then((value) => {
    value.value = 99;
    return value;
  });
  const follower = cache.get("shoe", load);
  await Promise.resolve();
  assert.equal(calls, 1);
  now = 100;
  response.resolve({ value: 1 });
  const [original, concurrent] = await Promise.all([first, follower]);
  assert.equal(original.value, 99);
  assert.equal(concurrent.value, 1);
  now = 149;
  const hit = await cache.get("shoe", load);
  assert.equal(hit.value, 1);
  hit.value = 42;
  assert.equal((await cache.get("shoe", load)).value, 1);
  now = 150;
  await cache.get("shoe", load);
  assert.equal(calls, 2);
});

test("cache evicts the least recently used result at its configured bound", async () => {
  const cache = new RequestCache<string>({
    enabled: true, ttlMs: 100, maxEntries: 2, now: () => 0,
    clone: (value) => value, isCacheable: () => true,
  });
  const calls: string[] = [];
  const get = (key: string) => cache.get(key, async () => { calls.push(key); return key; });
  await get("a");
  await get("b");
  await get("a");
  await get("c");
  await get("a");
  await get("b");
  assert.deepEqual(calls, ["a", "b", "c", "b"]);
});

test("rejected loads retry and incomplete results are not retained", async () => {
  const cache = new RequestCache<{ complete: boolean }>({
    enabled: true, ttlMs: 100, maxEntries: 2,
    clone: (value) => ({ ...value }), isCacheable: (value) => value.complete,
  });
  let calls = 0;
  const load = async () => {
    calls += 1;
    if (calls === 1) throw new Error("Provider unavailable");
    return { complete: calls >= 3 };
  };
  await assert.rejects(cache.get("shoe", load), /Provider unavailable/);
  assert.equal((await cache.get("shoe", load)).complete, false);
  assert.equal((await cache.get("shoe", load)).complete, true);
  assert.equal((await cache.get("shoe", load)).complete, true);
  assert.equal(calls, 3);
});

test("controller fetches search and popular results again after each completed request", async (context) => {
  mockEnrichment(context);
  const search = context.mock.method(goat, "getProductsAndInfo", async () => [new Sneaker({
    styleID: "ABC-123", shoeName: "Original", resellPrices: { goat: { "9": 100 } },
  })]);
  const api = new SneaksAPI();
  const [original] = await api.getProducts("Jordan", 1);
  assert.ok(original);
  original.shoeName = "Changed";
  const originalPrices = original.resellPrices.goat;
  assert.ok(originalPrices);
  originalPrices["9"] = 999;
  const [cached] = await api.getProducts("Jordan", 1);
  assert.equal(cached?.shoeName, "Original");
  assert.equal(cached?.resellPrices.goat?.["9"], 100);
  assert.notEqual(cached, original);
  await api.getProducts("Jordan", 2);
  await api.getMostPopular(1);
  await api.getProducts("", 1);
  await api.getMostPopular(1);
  assert.equal(search.mock.callCount(), 6);
});

test("controller shares concurrent price requests, scrapes again afterward, and preserves the catalog snapshot", async (context) => {
  mockEnrichment(context);
  let now = 0;
  const started = deferred<void>();
  const response = deferred<void>();
  const search = context.mock.method(goat, "getProductsAndInfo", async () => [new Sneaker({ styleID: "ABC-123" })]);
  const prices = context.mock.method(stockX, "getPrices", async (shoe: SneakerDocument) => {
    started.resolve(undefined);
    await response.promise;
    shoe.resellPrices.stockX = { "9": 125 };
  });
  const api = new SneaksAPI({ cache: { now: () => now, searchTtlMs: 100, priceTtlMs: 10 } });
  const first = api.getProductPrices(" abc-123 ");
  const concurrent = api.getProductPrices("ABC-123");
  await started.promise;
  assert.equal(search.mock.callCount(), 1);
  assert.equal(prices.mock.callCount(), 1);
  response.resolve(undefined);
  const [original, follower] = await Promise.all([first, concurrent]);
  assert.notEqual(original, follower);
  const originalPrices = original.resellPrices.stockX;
  assert.ok(originalPrices);
  originalPrices["9"] = 999;
  assert.equal(follower.resellPrices.stockX?.["9"], 125);
  assert.equal((await api.getProductPrices("abc-123")).resellPrices.stockX?.["9"], 125);
  assert.equal(prices.mock.callCount(), 2);
  const [catalog] = await api.getProducts("ABC-123", 1);
  assert.deepEqual(catalog?.resellPrices.stockX, {});
  now = 10;
  await api.getProductPrices("ABC-123");
  assert.equal(prices.mock.callCount(), 3);
  assert.equal(search.mock.callCount(), 4);
});

test("partial price responses retry providers without polluting cached catalog data", async (context) => {
  mockEnrichment(context);
  const search = context.mock.method(goat, "getProductsAndInfo", async () => [new Sneaker({ styleID: "ABC-123" })]);
  let unavailable = true;
  const prices = context.mock.method(stockX, "getPrices", async () => {
    if (unavailable) throw new Error("StockX unavailable");
  });
  const api = new SneaksAPI();
  const partial = await api.getProductPrices("ABC-123");
  assert.equal(partial.providerErrors[0]?.provider, "stockX");
  unavailable = false;
  assert.equal((await api.getProductPrices("ABC-123")).providerErrors.length, 0);
  await api.getProductPrices("ABC-123");
  assert.equal(prices.mock.callCount(), 3);
  assert.equal(search.mock.callCount(), 3);
});

test("search responses retry enrichment on every completed request", async (context) => {
  mockEnrichment(context);
  const search = context.mock.method(goat, "getProductsAndInfo", async () => [new Sneaker({ styleID: "ABC-123" })]);
  let unavailable = true;
  context.mock.method(flightClub, "getLink", async () => {
    if (unavailable) throw new Error("Flight Club unavailable");
  });
  const api = new SneaksAPI();
  assert.equal((await api.getProducts("Jordan", 1))[0]?.providerErrors.length, 1);
  unavailable = false;
  assert.equal((await api.getProducts("Jordan", 1))[0]?.providerErrors.length, 0);
  await api.getProducts("Jordan", 1);
  assert.equal(search.mock.callCount(), 3);
});

test("SNEAKS_CACHE_ENABLED=false disables completed caching and request sharing", async (context) => {
  const previous = process.env.SNEAKS_CACHE_ENABLED;
  process.env.SNEAKS_CACHE_ENABLED = "false";
  try {
    const search = context.mock.method(goat, "getProductsAndInfo", async () => []);
    const api = new SneaksAPI();
    await Promise.all([api.getProducts("Jordan", 1), api.getProducts("Jordan", 1)]);
    await api.getProducts("Jordan", 1);
    assert.equal(search.mock.callCount(), 3);
  } finally {
    if (previous === undefined) delete process.env.SNEAKS_CACHE_ENABLED;
    else process.env.SNEAKS_CACHE_ENABLED = previous;
  }
});
