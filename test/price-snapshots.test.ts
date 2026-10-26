import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import SneaksAPI from "../controllers/sneaks.controllers.js";
import { NeonPriceSnapshotStore } from "../db/price-snapshot-store.js";
import Sneaker, { type SneakerDocument } from "../models/Sneaker.js";
import goat from "../scrapers/goat-scraper.js";
import flightClub from "../scrapers/flightclub-scraper.js";
import stadiumGoods from "../scrapers/stadiumgoods-scraper.js";
import stockX from "../scrapers/stockx-scraper.js";

async function withDatabase(run: () => Promise<void>): Promise<void> {
  const previous = process.env.NEON_DATABASE_URL;
  process.env.NEON_DATABASE_URL = "postgresql://user:password@ep-example.neon.tech/sneaks?sslmode=require";
  try {
    await run();
  } finally {
    if (previous === undefined) delete process.env.NEON_DATABASE_URL;
    else process.env.NEON_DATABASE_URL = previous;
  }
}

function mockProviders(context: TestContext, setPrice: (shoe: SneakerDocument) => void = (shoe) => {
  shoe.resellPrices.goat = { "9": 125 };
}): void {
  for (const scraper of [flightClub, stadiumGoods]) {
    context.mock.method(scraper, "getLink", async () => {});
    context.mock.method(scraper, "getPrices", async () => {});
  }
  context.mock.method(stockX, "getPrices", async () => {});
  context.mock.method(goat, "getPictures", async () => {});
  context.mock.method(goat, "getPrices", async (shoe: SneakerDocument) => {
    setPrice(shoe);
  });
}

test("each completed price request scrapes again and records its new result", async (context) => {
  await withDatabase(async () => {
    let price = 100;
    mockProviders(context, (shoe) => {
      shoe.resellPrices.goat = { "9": price };
      price = 125;
    });
    const catalog = context.mock.method(goat, "getProductsAndInfo", async () => [new Sneaker({ styleID: "ABC-123" })]);
    const save = context.mock.method(NeonPriceSnapshotStore.prototype, "save", async () => {});
    const api = new SneaksAPI();

    assert.equal((await api.getProductPrices("ABC-123")).resellPrices.goat?.["9"], 100);
    const refreshed = await api.getProductPrices("ABC-123");
    assert.equal(refreshed.resellPrices.goat?.["9"], 125);
    assert.ok(refreshed.priceDataUpdatedAt);
    assert.equal(catalog.mock.callCount(), 2);
    assert.equal(save.mock.callCount(), 2);
  });
});

test("a failed product refresh removes snapshots older than the attempted scrape", async (context) => {
  await withDatabase(async () => {
    const remove = context.mock.method(NeonPriceSnapshotStore.prototype, "deleteBefore", async () => {});
    context.mock.method(goat, "getProductsAndInfo", async () => { throw new Error("catalog unavailable"); });

    await assert.rejects(new SneaksAPI().getProductPrices("abc-123"), /catalog unavailable/);
    assert.equal(remove.mock.callCount(), 1);
    assert.equal(remove.mock.calls[0]?.arguments[0], "ABC-123");
    assert.ok(Number.isFinite(Date.parse(remove.mock.calls[0]?.arguments[1] ?? "")));
  });
});

test("scheduled refresh reports a failed database save", async (context) => {
  await withDatabase(async () => {
    mockProviders(context);
    context.mock.method(goat, "getProductsAndInfo", async () => [new Sneaker({ styleID: "ABC-123" })]);
    const save = context.mock.method(NeonPriceSnapshotStore.prototype, "save", async () => { throw new Error("database unavailable"); });
    context.mock.method(NeonPriceSnapshotStore.prototype, "deleteBefore", async () => {});
    const api = new SneaksAPI({ cache: { enabled: false }, trackPriceSnapshotUsage: false, failOnPriceSnapshotError: true });

    await assert.rejects(api.getProductPrices("ABC-123"), /database unavailable/);
    assert.equal(save.mock.calls[0]?.arguments[2], false);
  });
});
