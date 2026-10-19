
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

Sneaks API is a sneaker API built with TypeScript, Node.js, Express, and Got. It collects sneaker information from StockX and price information from Stadium Goods, Goat, and Flight Club. Product data can include:

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

The scrapers depend on undocumented third-party endpoints. Those services can change their responses or block requests, and live availability is not guaranteed. Automated tests use mocked responses to check behavior; passing tests do not establish that every live scraper endpoint works.

