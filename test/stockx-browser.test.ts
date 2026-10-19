import assert from "node:assert/strict";
import test from "node:test";
import stockXBrowser from "../scrapers/stockx-browser.js";

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
