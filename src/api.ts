export { handler, app } from "../index.js";

export const config = {
  path: [
    "/",
    "/popular",
    "/search/*",
    "/id/*",
    "/.netlify/functions/api",
    "/.netlify/functions/api/*",
  ],
};
