import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import nock from "nock";
import Sneaker from "../models/Sneaker.js";
import goat from "../scrapers/goat-scraper.js";
import flightClub from "../scrapers/flightclub-scraper.js";
import browser from "../scrapers/stockx-browser.js";
import { parseGoatPrices, parseFlightClubPrices } from "../scrapers/goat-storefront.js";

before(() => nock.disableNetConnect());
after(() => nock.enableNetConnect());
afterEach(() => {
  const pending = nock.pendingMocks();
  nock.cleanAll();
  assert.deepEqual(pending, []);
});

// These fields and prices were observed in the live US storefront buy bar.
const goatVariant = {
  sizeOption: { presentation: "8", value: 8 }, shoeCondition: "new_no_defects",
  boxCondition: "good_condition", lowestPriceCents: { currency: "USD", amount: 30100, amountUsdCents: 30100 },
  instantShipLowestPriceCents: { currency: "USD", amount: 10000 },
  lastSoldPriceCents: { currency: "USD", amount: 28900 }, stockStatus: "single_in_stock",
};
const flightVariant = {
  productTemplateId: 585885, size: { value: 8, display: "8" },
  lowestPriceOption: { price: { display: "$301", localizedValue: 30100, value: 30100 }, isAvailable: true },
  shoeCondition: "new_no_defects", boxCondition: "good_condition", isInstantShip: false,
};

function flightHTML(product: Record<string, unknown> = {}, region: Record<string, unknown> = {}): string {
  return `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: {
    shoppingRegionData: { country: "US", currencyCode: "USD", ...region },
    productTemplate: { id: 585885, sku: "FY2903", sizeUnit: "us", singleGender: "men", newSizes: [flightVariant], ...product },
  } } })}</script>`;
}

test("GOAT parses current Buy New prices instead of cheaper used, no-box, instant or last-sale values", () => {
  const prices = parseGoatPrices([
    goatVariant,
    { ...goatVariant, boxCondition: "no_original_box", lowestPriceCents: { currency: "USD", amount: 7500 } },
    { ...goatVariant, boxCondition: "missing_lid", lowestPriceCents: { currency: "USD", amount: 9500 } },
    { ...goatVariant, shoeCondition: "used", lowestPriceCents: { currency: "USD", amount: 8700 } },
    { ...goatVariant, shoeCondition: "new_with_defects", lowestPriceCents: { currency: "USD", amount: 9900 } },
    { ...goatVariant, sizeOption: { value: 9, presentation: "9" }, lowestPriceCents: { currency: "USD", amount: 27100 } },
    { ...goatVariant, sizeOption: { value: 10, presentation: "10" }, stockStatus: "not_in_stock" },
    { ...goatVariant, sizeOption: { value: 11, presentation: "11" }, lowestPriceCents: { currency: "USD" } },
    { ...goatVariant, sizeOption: { value: "__proto__" } },
  ]);
  assert.deepEqual(prices, { "8": 301, "9": 271 });
});

test("GOAT rejects foreign currency and malformed payloads and accepts a genuinely sold-out response", () => {
  assert.throws(() => parseGoatPrices({}), /invalid buy-bar/);
  assert.throws(() => parseGoatPrices([null]), /invalid variant/);
  assert.throws(() => parseGoatPrices([{ ...goatVariant, lowestPriceCents: { currency: "EUR", amount: 30100 } }]), /not in USD/);
  assert.deepEqual(parseGoatPrices([]), {});
  assert.deepEqual(parseGoatPrices([{ ...goatVariant, stockStatus: "not_in_stock" }]), {});
});

test("Flight Club reads its current US new-size options and keeps the product's native US sizes", () => {
  const html = flightHTML({ newSizes: [
    flightVariant,
    { ...flightVariant, boxCondition: "no_original_box", lowestPriceOption: { isAvailable: true, price: { value: 8800 } } },
    { ...flightVariant, shoeCondition: "used", lowestPriceOption: { isAvailable: true, price: { value: 1000 } } },
    { ...flightVariant, isInstantShip: true, lowestPriceOption: { isAvailable: true, price: { value: 2000 } } },
    { ...flightVariant, productTemplateId: 999, lowestPriceOption: { isAvailable: true, price: { value: 100 } } },
    { ...flightVariant, size: { value: 9, display: "US 9" }, lowestPriceOption: { isAvailable: true, price: { localizedValue: 27100, value: 99999 } } },
    { ...flightVariant, size: { value: 10 }, lowestPriceOption: { isAvailable: false, price: { value: 100 } } },
  ] });
  assert.deepEqual(parseFlightClubPrices(html, "FY2903"), { "8": 301, "9": 271 });
  assert.deepEqual(parseFlightClubPrices(flightHTML({ singleGender: "women", newSizes: [{ ...flightVariant, size: { value: 9, display: "9" } }] }), "FY2903"), { "9": 301 });
});

test("Flight Club rejects the wrong style, foreign region, currency and non-US size systems", () => {
  assert.throws(() => parseFlightClubPrices(flightHTML({ sku: "OTHER" }), "FY2903"), /different manufacturer/);
  assert.throws(() => parseFlightClubPrices(flightHTML({}, { country: "GB" }), "FY2903"), /United States/);
  assert.throws(() => parseFlightClubPrices(flightHTML({}, { currencyCode: "EUR" }), "FY2903"), /USD/);
  assert.throws(() => parseFlightClubPrices(flightHTML({ sizeUnit: "eu" }), "FY2903"), /not US sizes/);
  assert.throws(() => parseFlightClubPrices("<html></html>", "FY2903"), /missing its public product data/);
});

test("GOAT uses the current US buy-bar endpoint when direct HTTP is available", async (context) => {
  nock("https://www.goat.com").replyContentLength().get("/web-api/v1/product_variants/buy_bar_data")
    .query({ productTemplateId: "585885", countryCode: "US" }).reply(200, [goatVariant]);
  const fallback = context.mock.method(browser, "getGoatPrices", async () => { throw new Error("No fallback expected"); });
  const shoe = new Sneaker({ styleID: "FY2903", goatProductId: 585885, resellLinks: { goat: "https://www.goat.com/sneakers/yeezy-boost-350-v2-cinder-fy2903" } });
  await goat.getPrices(shoe);
  assert.deepEqual(shoe.resellPrices.goat, { "8": 301 });
  assert.equal(shoe.lowestResellPrice.goat, 301);
  assert.equal(shoe.toObject().lowestResellPrice.goat, 301);
  assert.equal(fallback.mock.callCount(), 0);
});

test("GOAT blocked HTTP falls back to live public browser data without stale catalog prices", async (context) => {
  nock("https://www.goat.com").replyContentLength().get("/web-api/v1/product_variants/buy_bar_data").query(true).reply(403, "Blocked");
  const fallback = context.mock.method(browser, "getGoatPrices", async () => [goatVariant]);
  const link = "https://www.goat.com/sneakers/yeezy-boost-350-v2-cinder-fy2903";
  const shoe = new Sneaker({ styleID: "FY2903", goatProductId: 585885, resellLinks: { goat: link },
    resellPrices: { goat: { "8": 250 } }, lowestResellPrice: { goat: 78 } });
  await goat.getPrices(shoe);
  assert.deepEqual(shoe.resellPrices.goat, { "8": 301 });
  assert.equal(shoe.lowestResellPrice.goat, 301);
  assert.deepEqual(fallback.mock.calls[0]?.arguments, [link, 585885]);
});

test("Flight Club prices come from current public product data over HTTP", async () => {
  nock("https://www.flightclub.com").replyContentLength().get("/yeezy-boost-350-v2-cinder-fy2903").reply(200, flightHTML());
  const shoe = new Sneaker({ styleID: "FY2903", resellLinks: { flightClub: "https://www.flightclub.com/yeezy-boost-350-v2-cinder-fy2903" }, lowestResellPrice: { flightClub: 147 } });
  await flightClub.getPrices(shoe);
  assert.deepEqual(shoe.resellPrices.flightClub, { "8": 301 });
  assert.equal(shoe.lowestResellPrice.flightClub, 301);
  assert.equal(shoe.toObject().lowestResellPrice.flightClub, 301);
});

test("Flight Club blocked HTTP uses the current rendered public page", async (context) => {
  nock("https://www.flightclub.com").replyContentLength().get("/yeezy-boost-350-v2-cinder-fy2903").reply(403, "Blocked");
  const fallback = context.mock.method(browser, "getFlightClubPage", async () => flightHTML());
  const link = "https://www.flightclub.com/yeezy-boost-350-v2-cinder-fy2903";
  const shoe = new Sneaker({ styleID: "FY2903", resellLinks: { flightClub: link } });
  await flightClub.getPrices(shoe);
  assert.deepEqual(shoe.resellPrices.flightClub, { "8": 301 });
  assert.deepEqual(fallback.mock.calls[0]?.arguments, [link]);
});

test("live price failures clear prior stale quotes instead of falling back to catalog values", async (context) => {
  nock("https://www.goat.com").replyContentLength().get("/web-api/v1/product_variants/buy_bar_data").query(true).reply(403, "Blocked");
  context.mock.method(browser, "getGoatPrices", async () => { throw new Error("Storefront blocked"); });
  const shoe = new Sneaker({ styleID: "FY2903", goatProductId: 585885, resellLinks: { goat: "https://www.goat.com/sneakers/cinder" },
    resellPrices: { goat: { "8": 250 } }, lowestResellPrice: { goat: 78 } });
  await assert.rejects(goat.getPrices(shoe), /Storefront blocked/);
  assert.deepEqual(shoe.resellPrices.goat, {});
  assert.equal(shoe.lowestResellPrice.goat, undefined);
});
