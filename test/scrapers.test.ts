import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import nock from "nock";
import Sneaker from "../models/Sneaker.js";
import http from "../scrapers/http.js";
import flightClub from "../scrapers/flightclub-scraper.js";
import goat from "../scrapers/goat-scraper.js";
import stadiumGoods from "../scrapers/stadiumgoods-scraper.js";

before(() => nock.disableNetConnect());
after(() => nock.enableNetConnect());
afterEach(() => nock.cleanAll());

test("provider HTTP client preserves errors without retrying a failed request", async () => {
  const scope = nock("https://example.com").replyContentLength()
    .get("/unavailable").once().reply(503, { error: "unavailable" });
  await assert.rejects(http.get("https://example.com/unavailable"), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.ok("response" in error && typeof error.response === "object" && error.response !== null);
    assert.ok("statusCode" in error.response);
    assert.equal(error.response.statusCode, 503);
    return true;
  });
  assert.ok(scope.isDone());
});

test("optional provider operations skip shoes without product links", async () => {
  const shoe = new Sneaker({ styleID: "AA-123" });
  await Promise.all([
    flightClub.getPrices(shoe), goat.getPrices(shoe),
    goat.getPictures(shoe), stadiumGoods.getPrices(shoe),
  ]);
});
