import assert from "node:assert/strict";
import test from "node:test";
import nock from "nock";
import Sneaker from "../models/Sneaker.js";
import klekt, { parseKlektListing } from "../scrapers/klekt-scraper.js";

function listing(style = "HQ7978-001", size = "US 9", price = "200.35", currency = "USD", condition = "Deadstock / New") {
  return `<html><script type="application/ld+json">${JSON.stringify({
    "@type": "Product", sku: style, offers: { price, priceCurrency: currency, availability: "https://schema.org/InStock" },
  })}</script><ul><li><span>SKU</span><span>${style}</span></li>
  <li><span>Condition</span><span>${condition}</span></li><li><span>Includes</span><span>Original Box</span></li>
  <li><span>Size</span><span>${size}</span></li></ul></html>`;
}

test("KLEKT validates exact style, new condition, native US size, and USD", () => {
  assert.deepEqual(parseKlektListing(listing(), "HQ7978-001"), { size: "9", price: 200.35 });
  assert.equal(parseKlektListing(listing("OTHER"), "HQ7978-001"), undefined);
  assert.equal(parseKlektListing(listing("HQ7978-001", "EU 42"), "HQ7978-001"), undefined);
  assert.equal(parseKlektListing(listing("HQ7978-001", "US 9", "200", "EUR"), "HQ7978-001"), undefined);
  assert.equal(parseKlektListing(listing("HQ7978-001", "US 9", "200", "USD", "Like New"), "HQ7978-001"), undefined);
});

test("KLEKT checks listings individually and retains the lowest verified price for a size", async () => {
  const scope = nock("https://klekt.com");
  scope.get("/catalog").query({ search: "HQ7978-001" }).reply(200,
    '<input value="HQ7978-001"><a href="/listing/first">one</a><a href="/listing/second">two</a><a href="/listing/wrong">wrong</a>');
  scope.get("/listing/first").reply(200, listing());
  scope.get("/listing/second").reply(200, listing("HQ7978-001", "US 9", "180"));
  scope.get("/listing/wrong").reply(200, listing("OTHER"));
  const shoe = new Sneaker({ styleID: "HQ7978-001" });
  await klekt.getPrices(shoe);
  assert.deepEqual(shoe.resellPrices.klekt, { "9": 180 });
  assert.equal(shoe.lowestResellPrice.klekt, 180);
  assert.equal(shoe.resellLinks.klekt, "https://klekt.com/catalog?search=HQ7978-001");
  scope.done();
});
