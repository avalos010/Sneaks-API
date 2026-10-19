import "dotenv/config";
import express from "express";
import serverless from "serverless-http";
import createRoutes from "./routes/sneaks.routes.js";
import SneaksAPI from "./controllers/sneaks.controllers.js";

export const app = express();
export const router = createRoutes();

app.use("/.netlify/functions/api", router);
app.use("/", router);

export { SneaksAPI };
export type { SneaksCallback } from "./controllers/sneaks.controllers.js";
export type { SneakerData, SneakerDocument, Retailer, PriceMap } from "./models/Sneaker.js";
export const handler = serverless(app);
export default SneaksAPI;
