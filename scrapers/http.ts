import got from "got";

/** Bound provider requests so a failed provider cannot leave the API waiting. */
const http = got.extend({
  timeout: { request: 15_000 },
  retry: { limit: 0 },
  headers: { "user-agent": "Sneaks-API" },
});

export default http;
