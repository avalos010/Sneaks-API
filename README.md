
<p align="center">
  
<img src="https://github.com/druv5319/Sneaks-API/blob/master/Screenshots/Sneaks_Logo.png?raw=true" width=250>
  
  </p>
  
<p align="center">
  
   <a href="https://www.npmjs.com/package/sneaks-api" alt="Version">
        <img src="https://img.shields.io/npm/v/sneaks-api" /></a>
<a href="https://www.npmjs.com/package/sneaks-api" alt="Downloads">
        <img src="https://img.shields.io/npm/dt/sneaks-api " /></a>


 </p>

A StockX API, FlightClub API, Goat API, and Stadium Goods API all in one.

Sneaks API is a sneaker API built with TypeScript, Node.js, Express, and Got. It searches the GOAT storefront catalog and collects publicly available prices from GOAT, Flight Club, Stadium Goods, and StockX. No developer account or private API key is required. Product data can include:

  - Sneaker Name
  - Colorway
  - Description
  - Release Date
  - Retail Price
  - Style ID
  - Image Links
  - Product links from each of the resell sites
  - Price map (of shoe size to price) from each of the resell sites
  - And more
  
  
  

I built this API so sneaker heads and developers are able to create sneaker based programs, trackers and websites without having to fumble with scrapping information on all 4 resell websites. Feel free to fork, edit and submit a pull request for this API for any changes or improvements. If you have any questions or issues regarding this feel free to create an issue and I will try to answer them as soon as I can.

## Demo
### Sneaks App - [Github](https://github.com/druv5319/sneaks-app)
<img src="https://github.com/druv5319/Sneaks-API/blob/master/Screenshots/demo.gif" width=700 >

### [Twilio Blog Tutorial](https://www.twilio.com/blog/build-price-tracker-twilio-programmable-sms-node): Build a Sneaker Price Tracker with Twilio Programmable SMS
  <img src="https://github.com/druv5319/Sneaks-API/blob/master/Screenshots/euCdtWvMESTjo9_Smd_wRpoNvhk6XOr3n3QlnHYNRAHHU.width-1000_RWrysBn-2.png" width="350"> <img src="https://github.com/druv5319/Sneaks-API/blob/master/Screenshots/syHg2FzA1dcFjpp6XlqNq_ZRNDXJPcdWCJzGhBcU2PPXv.width-1000_VZzgt9G.png" width="350">


## Installation

Use Node.js 22.12 or newer. This branch migrates the project to strict TypeScript and native ES modules. The build includes TypeScript declarations at `build/index.d.ts`.

```sh
npm install sneaks-api
```

## How to Use

All three methods support Promises:

```ts
import SneaksAPI from 'sneaks-api';

const sneaks = new SneaksAPI();

try {
    const products = await sneaks.getProducts('Yeezy Cinder', 10);
    console.log(products);

    // Use a product's styleID to retrieve its prices and additional details.
    const product = await sneaks.getProductPrices('FY2903');
    console.log(product);

    const popular = await sneaks.getMostPopular(10);
    console.log(popular);
} catch (error) {
    console.error(error);
}
```

Callback usage is also supported:

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

sneaks.getProductPrices('FY2903', (error, product) => {
    if (error) {
        console.error(error);
        return;
    }
    console.log(product);
});

sneaks.getMostPopular(10, (error, products) => {
    if (error) {
        console.error(error);
        return;
    }
    console.log(products);
});
```

For a CommonJS application, replace `require('sneaks-api')` with dynamic import inside an async function:

```js
async function main() {
    const { default: SneaksAPI } = await import('sneaks-api');
    const sneaks = new SneaksAPI();
    console.log(await sneaks.getMostPopular(10));
}

main().catch(console.error);
```

[Console log](https://github.com/druv5319/Sneaks-API/blob/master/Screenshots/exampleSearchScreenshot%231.png) of sneaks.getProducts("Yeezy Cinder", ...)           
[Console log](https://github.com/druv5319/Sneaks-API/blob/master/Screenshots/exampleSearchScreenshot%232.png) of sneaks.getProductPrices("FY2903", ...)

## Local Development

Use npm for dependency installation; `package-lock.json` is the sole lockfile.

```sh
npm ci
npm run dev
```

The development server listens on port 4000. To check and build the project:

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm start
```

`npm start` runs the built local server, so run `npm run build` first. Importing the library does not start a server.

Run `npm run check` for lint, typecheck, tests, and build together. TypeScript strict mode rejects implicit `any`; lint rejects explicit `any` and comments that suppress type checking.

With the server running, use `npm run test:live` to exercise both route prefixes, catalog results, actual GOAT and Flight Club size prices, and validation. Set `API_BASE_URL` to test another running instance.

Use `REQUIRE_STOCKX=1 npm run test:live` to require real StockX size prices as well. StockX's browser fallback needs Google Chrome installed and a graphical desktop session. It opens its own temporary Chrome profile, reuses it briefly, and closes it after 30 seconds without requests. It does not use your personal Chrome profile or require a StockX login. Set `STOCKX_CHROME_PATH` (or `CHROME_BIN`) if Chrome is installed somewhere other than a standard location.

## HTTP API and Netlify

The local server and Netlify function expose these routes:

| Method | Path | Description |
| --- | --- | --- |
| GET | `/.netlify/functions/api/popular` | Popular products |
| GET | `/.netlify/functions/api/search/:shoe` | Search by a URL-encoded sneaker keyword |
| GET | `/.netlify/functions/api/id/:id/prices` | Product details and prices for a style ID |

The popular and search routes accept a `count` query parameter. It defaults to 40 and must be an integer from 1 to 100. For example:

```sh
curl 'http://localhost:4000/.netlify/functions/api/search/Yeezy%20Cinder?count=10'
```

Netlify builds the TypeScript function from `src/api.ts` using its native TypeScript support and the esbuild function bundler configured in `netlify.toml`. This replaces the previous netlify-lambda, Babel, and webpack workflow.

## Data Availability

Search and popular products use the GOAT storefront catalog. Popular products follow the catalog's default ranking. GOAT and Flight Club prices and images come from their storefront search records; Stadium Goods uses its Shopify storefront. The retired StockX Algolia index, GOAT web API, Flight Club token/GraphQL calls, and Stadium Goods GraphQL hostname are no longer used.

| Provider | Current integration |
| --- | --- |
| GOAT | `POST https://2fwotdvm2o-dsn.algolia.net/1/indexes/*/queries`, index `product_variants_v2` |
| Flight Club | Same catalog URL, index `product_variants_v2_flight_club` |
| Stadium Goods | `GET https://www.stadiumgoods.com/search/suggest.json` and `GET /products/{handle}.js` |
| StockX | Public search/product pages at `https://stockx.com`, with embedded product data when the site permits access |

StockX uses ordinary HTTP when the returned page contains complete product data, then renders the public page in Chrome when necessary. The browser transport currently uses visible Chrome: headless Chrome was blocked during live verification. A server deployment needs a compatible Chrome installation and graphical display or a separate browser worker; standard Netlify Functions do not provide these. The other three providers use HTTP and continue to work when the StockX browser is unavailable.

Provider failures are reported in the product's `providerErrors` array, rather than represented as zero prices. The other providers continue to return data when one provider blocks a request. A provider with no matching product or no available sizes can have an empty price map.

Storefront endpoints can change their responses or block requests. Automated tests use mocked responses to check parsing and error handling; live smoke tests verify the currently reachable integrations.

