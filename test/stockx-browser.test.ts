import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import bundledChromium from "@sparticuz/chromium-min";
import { chromium } from "playwright-core";
import stockXBrowser from "../scrapers/stockx-browser.js";

const runtimeFlags = ["NETLIFY", "AWS_LAMBDA_FUNCTION_NAME", "AWS_LAMBDA_JS_RUNTIME"] as const;
const originalRuntime = new Map(runtimeFlags.map((name) => [name, process.env[name]]));

before(() => {
  // Netlify sets NETLIFY=true during builds too. These unit tests must select
  // their runtime explicitly instead of downloading or launching a browser.
  for (const name of runtimeFlags) delete process.env[name];
});
after(async () => {
  await stockXBrowser.close();
  for (const [name, value] of originalRuntime) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

test("browser rejects an invalid mode before launching Chrome", async () => {
  const previous = process.env.STOCKX_BROWSER_MODE;
  process.env.STOCKX_BROWSER_MODE = "invalid";
  try {
    await assert.rejects(stockXBrowser.getPage("https://stockx.com/search?s=FY2903"), /STOCKX_BROWSER_MODE must be/);
  } finally {
    if (previous === undefined) delete process.env.STOCKX_BROWSER_MODE;
    else process.env.STOCKX_BROWSER_MODE = previous;
    await stockXBrowser.close();
  }
});

// These checks must never launch Chrome; deterministic provider tests mock getPage.
// The opt-in live suite separately exercises actual native Chrome hydration.
test("StockX browser rejects external, insecure and credential-bearing URLs before launch", async () => {
  const configured = process.env.STOCKX_CHROME_PATH;
  process.env.STOCKX_CHROME_PATH = "/nonexistent/sneaks-test-chrome";
  try {
    for (const url of [
      "http://stockx.com/search?s=shoe",
      "https://example.com/search",
      "https://stockx.com.example.com/search",
      "https://stockx.com:444/search",
      "https://user:password@stockx.com/search",
      "file:///tmp/stockx.html",
    ]) {
      await assert.rejects(stockXBrowser.getPage(url), /only accepts public https:\/\/stockx.com URLs/);
    }
    await assert.rejects(stockXBrowser.getPage("not a URL"), TypeError);
  } finally {
    if (configured === undefined) delete process.env.STOCKX_CHROME_PATH;
    else process.env.STOCKX_CHROME_PATH = configured;
    await stockXBrowser.close();
  }
});

test("retailer price fallbacks validate product origins and template identifiers before launch", async () => {
  for (const url of [
    "https://example.com/sneakers/shoe", "https://goat.com/sneakers/shoe",
    "https://www.goat.com/search", "https://user:pass@www.goat.com/sneakers/shoe",
    "https://www.goat.com/sneakers/shoe?redirect=elsewhere",
  ]) {
    await assert.rejects(stockXBrowser.getGoatPrices(url, 1), /GOAT browser only accepts/);
  }
  for (const id of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    await assert.rejects(stockXBrowser.getGoatPrices("https://www.goat.com/sneakers/shoe", id), /positive template ID/);
  }
  for (const url of [
    "http://www.flightclub.com/shoe", "https://example.com/shoe",
    "https://www.flightclub.com/", "https://www.flightclub.com/search?q=shoe",
    "https://user:pass@www.flightclub.com/shoe", "https://www.flightclub.com/shoe/nested",
  ]) {
    await assert.rejects(stockXBrowser.getFlightClubPage(url), /Flight Club browser only accepts/);
  }
  await stockXBrowser.close();
});

test("browser reports a missing configured executable and recovers the navigation queue", async () => {
  const configured = process.env.STOCKX_CHROME_PATH;
  process.env.STOCKX_CHROME_PATH = "/nonexistent/sneaks-test-chrome";
  try {
    await Promise.all([
      assert.rejects(stockXBrowser.getPage("https://stockx.com/search?s=FY2903"), /Install Google Chrome or set STOCKX_CHROME_PATH/),
      assert.rejects(stockXBrowser.getPage("https://stockx.com/adidas-yeezy-boost-350-v2-cinder"), /Install Google Chrome or set STOCKX_CHROME_PATH/),
    ]);
    await stockXBrowser.close();
    await stockXBrowser.close();
    await assert.rejects(stockXBrowser.getPage("https://stockx.com/search?s=FY2903"), /Install Google Chrome or set STOCKX_CHROME_PATH/);
  } finally {
    if (configured === undefined) delete process.env.STOCKX_CHROME_PATH;
    else process.env.STOCKX_CHROME_PATH = configured;
    await stockXBrowser.close();
  }
});

test("Netlify runtime selects bundled Chromium without native Chrome discovery", async (context) => {
  process.env.NETLIFY = "true";
  const configured = process.env.STOCKX_CHROME_PATH;
  process.env.STOCKX_CHROME_PATH = "/nonexistent/sneaks-test-chrome";
  const download = context.mock.method(bundledChromium, "executablePath", async () => {
    throw new Error("Mocked Chromium pack download");
  });
  const launch = context.mock.method(chromium, "launch", async () => {
    throw new Error("No browser may launch in this unit test");
  });
  try {
    await assert.rejects(stockXBrowser.getPage("https://stockx.com/search?s=FY2903"), /Mocked Chromium pack download/);
    assert.equal(download.mock.callCount(), 1);
    assert.equal(launch.mock.callCount(), 0);
  } finally {
    delete process.env.NETLIFY;
    if (configured === undefined) delete process.env.STOCKX_CHROME_PATH;
    else process.env.STOCKX_CHROME_PATH = configured;
    await stockXBrowser.close();
  }
});
