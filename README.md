<p align="center">
  <img src="Screenshots/Sneaks_Logo.png" alt="Sneaks API" width="250">
</p>

# Sneaks API

[![CI](https://github.com/avalos010/Sneaks-API/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/avalos010/Sneaks-API/actions/workflows/ci.yml)
![Node.js 22.12+](https://img.shields.io/badge/node-%3E%3D22.12-green)
![Strict TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)

Search sneakers and compare available size prices from **GOAT, Flight Club, Stadium Goods, and StockX**. Run it as a local HTTP API, import the library, or deploy the HTTP integrations with Netlify.

This fork uses strict TypeScript and native ES modules, preserves the callback API, and adds Promise-based methods. It reads public storefront data without requiring developer accounts or private API keys. Price lookups can render pages in a separate Chrome session when ordinary HTTP requests are blocked.

## What has changed

- Converted application code to strict TypeScript, with lint rules rejecting explicit `any` and type-check suppression comments.
- Updated dependencies and replaced the Babel, webpack, Netlify Lambda, and deprecated `request` tooling.
- Restored public provider integrations, including actual size prices and product images.
- Added `providerErrors` so a failed enrichment does not hide the prices returned by other retailers.
- Added CI on Node.js 22 and 24, live provider checks, and a command to enable required checks before merging.

## Quick start

Use **Node.js 22.12 or newer** and npm. A MongoDB connection is not required. Install Google Chrome for the storefront price fallbacks.

Clone the repository's default branch:

```sh
git clone https://github.com/avalos010/Sneaks-API.git
cd Sneaks-API
npm ci
npm run dev
```

The server starts at **http://localhost:4000** with hot reload. Try:

```sh
curl 'http://localhost:4000/popular?count=2'
curl 'http://localhost:4000/search/Jordan?count=2'
curl 'http://localhost:4000/id/AV5354-611/prices'
```

These instructions describe this repository's TypeScript implementation. Use this checkout to try the updates; installing the public `sneaks-api` npm package may give you a different release.

For a compiled server:

```sh
npm run build
npm start
```

Importing the library does not start an HTTP server.

## HTTP endpoints

| Method | Local path | Returns |
| --- | --- | --- |
| GET | `/` | `Hello World` |
| GET | `/popular` | Products in the GOAT catalog's default ranking |
| GET | `/search/:shoe` | Products matching a URL-encoded keyword |
| GET | `/id/:id/prices` | An exact style-ID match with available retailer prices and images |

Popular and search requests accept `count`, which defaults to **40** and must be an integer from **1 to 100**. Results can contain fewer products when fewer valid matches are available. Style IDs with supplier spaces are normalized to hyphens.

The local server also accepts the Netlify function prefix:

```sh
curl 'http://localhost:4000/.netlify/functions/api/search/Yeezy%20Cinder?count=2'
curl 'http://localhost:4000/.netlify/functions/api/id/FY2903/prices'
```

On Netlify, use `/.netlify/functions/api` as the base path. The deployment also rewrites clean paths such as `/popular` and `/search/Jordan` to the function; the forced rewrite is necessary because the published `dist/` directory contains an empty `index.html`.

| Status | Meaning |
| --- | --- |
| `200` | Successful request; an empty search result is `[]` |
| `400` | Invalid `count` |
| `404` | No exact style match for a price lookup, or an unknown route |
| `502` | The primary catalog could not return products |

A price request can return `200` with partial retailer data. Inspect `providerErrors` alongside each price map.

## Library usage

Build this checkout before importing it. To use it in another local project, run `npm install /absolute/path/to/Sneaks-API` from that project's directory after building.

### Promises and TypeScript

```ts
import SneaksAPI, { type SneakerDocument } from 'sneaks-api';

const sneaks = new SneaksAPI();

const products: SneakerDocument[] = await sneaks.getProducts('Yeezy Cinder', 10);
const popular = await sneaks.getMostPopular(10);
const shoe = await sneaks.getProductPrices('AV5354-611');

console.log(products, popular);
console.log(shoe.resellLinks);
console.log(shoe.resellPrices.goat);
console.log(shoe.resellPrices.flightClub);
console.log(shoe.resellPrices.stadiumGoods);
console.log(shoe.resellPrices.stockX);
console.log(shoe.providerErrors);
```

The build exports declarations from `build/index.d.ts`, including `SneakerData`, `SneakerDocument`, `Retailer`, `PriceMap`, `ProviderError`, and `SneaksCallback`.

### Callbacks

```ts
import SneaksAPI from 'sneaks-api';

const sneaks = new SneaksAPI();

sneaks.getProducts('Yeezy Cinder', 10, (error, products) => {
  if (error) {
    console.error(error);
    return;
  }
  console.log(products);
});

sneaks.getProductPrices('FY2903', (error, shoe) => {
  if (error) {
    console.error(error);
    return;
  }
  console.log(shoe);
});
```

`getMostPopular(count, callback)` is also supported. CommonJS applications can use dynamic import inside an async function:

```js
async function main() {
  const { default: SneaksAPI } = await import('sneaks-api');
  const sneaks = new SneaksAPI();
  console.log(await sneaks.getMostPopular(2));
}

main().catch(console.error);
```

## Product data and provider availability

Products can include a name, brand, style ID, colorway, retail price, release date, description, thumbnail, images, retailer links, lowest prices, and size-to-price maps. Prices are returned in **USD** when the source provides USD offers. Missing prices are not represented as zero.

GOAT and Flight Club prices match the US storefront's **new, no defects, good original box** options, with standard shipping speed. Their search indexes supply product metadata and links, not current price quotes. Use `/id/:id/prices` for size prices. Sizes use each product's native US sizing (for example, US women's sizes for a women's product). Prices are listing amounts; shipping, taxes, and separately displayed marketplace fees can increase the checkout total. StockX, for example, displays its marketplace fee separately from the Buy Now amount.

| Provider | Current source | Browser required? |
| --- | --- | --- |
| GOAT | Public catalog for discovery; current US product buy-bar data for prices | Sometimes; Chrome fallback for prices |
| Flight Club | Public catalog for discovery; product page's regional size offers for prices | Sometimes; Chrome fallback for prices |
| Stadium Goods | Shopify `/search/suggest.json` and `/products/{handle}.js` | No |
| StockX | Public search/product pages, visible style details, and embedded Product JSON-LD offers | Sometimes; Chrome fallback |

GOAT and Flight Club discovery uses `POST https://2fwotdvm2o-dsn.algolia.net/1/indexes/*/queries` (indexes `product_variants_v2` and `product_variants_v2_flight_club`). GOAT prices use the public storefront's `/web-api/v1/product_variants/buy_bar_data` response with `countryCode=US`. Flight Club prices come from its public product page. Stadium Goods uses `https://www.stadiumgoods.com`; StockX uses `https://stockx.com`.

Search and popular products depend on the GOAT catalog. Other provider enrichments are optional: if one fails, successful data remains available and `providerErrors` records its `provider`, `operation`, and `message`. A retailer with no matching product or no available inventory can have an empty price map without an error.

Public storefronts can change their markup, inventory, or access rules. Passing mocked tests verifies the code; live checks verify current responses from selected products.

### Storefronts and Chrome

StockX, GOAT prices, and Flight Club prices first attempt ordinary HTTP, then render the public page in Chrome if access is blocked or product data is incomplete. The fallback uses its own temporary profile, never your personal Chrome profile, and does not require a retailer login. Requests share that session briefly; it closes after **30 seconds** without requests. Catalog searches and Stadium Goods use HTTP without launching Chrome.

The default `background` mode creates **minimized, unfocused Chrome windows** so requests do not open a foreground browser window. It still requires a graphical desktop session. Set `STOCKX_BROWSER_MODE=headless` to run without windows; all three sites blocked this mode during verification, so their prices may be unavailable in `providerErrors`. Use `visible` when debugging the storefront. Linux servers can run native Chrome with a virtual display such as Xvfb. Standard Netlify Functions do not provide Chrome: catalog search and Stadium Goods can work there, while the other prices require accessible HTTP responses or a browser-capable worker.

### Caching

Each API instance caches successful searches and popular results for **60 seconds**, and complete price results for **30 seconds**. Concurrent requests for the same lookup share one scrape. Cached documents are copied before returning them so caller changes cannot alter later responses. Results with provider errors and rejected lookups are not stored.

The cache holds at most **100 entries each** for catalog and price results. It lives in memory: restarting the process clears it, and separate workers or serverless instances keep separate caches. The first uncached request still waits for the storefronts. Disable caching with `SNEAKS_CACHE_ENABLED=false`, or change the expiry settings below.

## Configuration

Server settings can come from environment variables or a local `.env` file. Pass live-test flags in the environment when running the test command.

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | Local HTTP server port | `4000` |
| `STOCKX_CHROME_PATH` | Chrome executable shared by storefront fallbacks | Detect a standard installation |
| `CHROME_BIN` | Alternative Chrome executable setting | Used when `STOCKX_CHROME_PATH` is unset |
| `STOCKX_BROWSER_MODE` | `background`, `headless`, or `visible` | `background` |
| `SNEAKS_CACHE_ENABLED` | Set to `false`, `0`, or `off` to disable caching | Enabled |
| `SNEAKS_SEARCH_CACHE_TTL_MS` | Search and popular result lifetime; `0` disables | `60000` |
| `SNEAKS_PRICE_CACHE_TTL_MS` | Complete price result lifetime; `0` disables | `30000` |
| `SNEAKS_CACHE_MAX_ENTRIES` | Maximum entries in each cache | `100` |
| `API_BASE_URL` | Running server used by live tests | `http://localhost:4000` |
| `REQUIRE_STOCKX` | Set to `1` to require StockX size prices in live tests | StockX prices are optional in the default live suite |

## Tests and local checks

| Command | Checks |
| --- | --- |
| `npm run lint` | Lint, no explicit `any`, and no type-check suppressions |
| `npm run typecheck` | Strict TypeScript compilation checks |
| `npm test` | Provider parsers, callbacks, promises, routes, and browser lifecycle behavior using mocks |
| `npm run build` | Compiled JavaScript, declarations, and source maps |
| `npm run check` | Lint, typecheck, tests, and build together |
| `npm run test:live` | Real catalog results, GOAT/Flight Club/Stadium Goods size prices, both route prefixes, and validation |
| `REQUIRE_STOCKX=1 npm run test:live` | The live suite with required StockX size prices too |

Start the server before running live tests. They use known product fixtures, whose inventory can change.

## CI, deployment, and merging

The [CI workflow](https://github.com/avalos010/Sneaks-API/actions/workflows/ci.yml) runs on every push, pull request, and merge-queue update. It checks Node.js **22 and 24**, including lint, strict types, mocked tests, build output, the built serverless handler, and npm package contents. Its **Required checks** status passes only when both versions succeed. Dependabot checks the pinned GitHub Actions versions weekly.

Netlify runs `npm run check` before deploying, as configured in [netlify.toml](netlify.toml).

The **Live providers** workflow checks GOAT, Flight Club, and Stadium Goods daily at **11:23 UTC**, using native Chrome with an Xvfb virtual display when required. It can also run manually, with an optional **StockX browser** check on macOS. Hosted-runner traffic may be blocked even when local scraping works. Logs are retained for seven days.

Scheduled runs and the manual workflow button become available once the workflow is merged into the default branch. The live jobs start and stop their own server. Live provider checks are separate from the deterministic merge checks.

### Enable required checks before merging

Workflows alone do not block merges. A repository administrator can enable the **Require CI before merging** ruleset:

```sh
gh auth login
npm run ci:protect
```

The command creates or updates only its named ruleset on the default branch, preserving other rulesets. It requires **Required checks** to pass on an up-to-date commit. Preview the configuration without changing GitHub:

```sh
npm run ci:protect -- --dry-run --repo avalos010/Sneaks-API
```

Alternatively, configure the same required status in **Settings → Rules → Rulesets** on GitHub.

## Original demo and credits

This fork builds on [druv5319/Sneaks-API](https://github.com/druv5319/Sneaks-API). The original demo and tutorial predate the TypeScript migration:

- [Sneaks App](https://github.com/druv5319/sneaks-app)
- [Twilio tutorial: build a sneaker price tracker](https://www.twilio.com/blog/build-price-tracker-twilio-programmable-sms-node)

<img src="Screenshots/demo.gif" alt="Original Sneaks App demo" width="700">
