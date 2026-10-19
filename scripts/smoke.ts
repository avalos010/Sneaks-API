import assert from "node:assert/strict";

const baseURL = process.env.API_BASE_URL ?? "http://localhost:4000";

function assertRecord(value: unknown): asserts value is Record<string, unknown> {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value));
}

async function check(path: string, expected: number): Promise<unknown> {
  const start = Date.now();
  const response = await fetch(new URL(path, baseURL), { signal: AbortSignal.timeout(45_000) });
  const text = await response.text();
  assert.equal(response.status, expected, `${path}: ${response.status} ${text.slice(0, 200)}`);
  console.log(`${response.status} ${path} (${Date.now() - start}ms)`);
  return response.headers.get("content-type")?.includes("application/json") ? JSON.parse(text) as unknown : text;
}

for (const prefix of ["", "/.netlify/functions/api"]) {
  assert.equal(await check(`${prefix}/`, 200), "Hello World");
  for (const path of ["/popular?count=2", "/search/Jordan?count=2"]) {
    const products = await check(`${prefix}${path}`, 200);
    assert.ok(Array.isArray(products));
    assert.ok(products.length > 0 && products.length <= 2);
    const first: unknown = products[0];
    assertRecord(first);
    assert.equal(typeof first.styleID, "string");
    assert.equal(typeof first.thumbnail, "string");
  }
  const product = await check(`${prefix}/id/FY2903/prices`, 200);
  assertRecord(product);
  assert.equal(product.styleID, "FY2903");
  assert.ok(Array.isArray(product.imageLinks) && product.imageLinks.length > 0);
  assertRecord(product.resellPrices);
  const providers = process.env.REQUIRE_STOCKX === "1" ? ["goat", "flightClub", "stockX"] : ["goat", "flightClub"];
  for (const provider of providers) {
    const prices = product.resellPrices[provider];
    assertRecord(prices);
    assert.ok(Object.keys(prices).length > 0, `${provider} should return actual size prices`);
    assert.ok(Object.values(prices).every((price) => typeof price === "number" && price > 0));
  }
}
const stadiumProduct = await check("/id/AV5354-611/prices", 200);
assertRecord(stadiumProduct);
assertRecord(stadiumProduct.resellPrices);
const stadiumPrices = stadiumProduct.resellPrices.stadiumGoods;
assertRecord(stadiumPrices);
assert.ok(Object.keys(stadiumPrices).length > 0, "Stadium Goods should return actual size prices for AV5354-611");
assert.ok(Object.values(stadiumPrices).every((price) => typeof price === "number" && price > 0));
await check("/popular?count=0", 400);
await check("/id/THIS-STYLE-DOES-NOT-EXIST-000000/prices", 404);
console.log(`Live endpoint checks passed, including GOAT, Flight Club, Stadium Goods${process.env.REQUIRE_STOCKX === "1" ? ", and StockX" : ""} size prices.`);
