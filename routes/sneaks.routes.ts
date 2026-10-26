import cors from "cors";
import { Router, type Response } from "express";
import SneaksAPI, { ProductNotFoundError } from "../controllers/sneaks.controllers.js";
import type { Retailer } from "../models/Sneaker.js";

function parseCount(value: unknown): number | undefined {
  if (value === undefined) return 40;
  if (typeof value !== "string" || !/^\d+$/.test(value)) return undefined;
  const count = Number(value);
  return Number.isSafeInteger(count) && count > 0 && count <= 100 ? count : undefined;
}

function sendProviderError(response: Response, error: unknown): void {
  if (error instanceof ProductNotFoundError) {
    response.status(404).json({ error: "Product Not Found" });
    return;
  }
  response.status(502).json({ error: "Unable to retrieve products from the provider" });
}

export function createRoutes(sneaks = new SneaksAPI()): Router {
  const router = Router();
  router.use(cors());

  router.get("/", (_request, response) => {
    response.send("Hello World");
  });

  router.get("/popular", async (request, response) => {
    const count = parseCount(request.query.count);
    if (count === undefined) {
      response.status(400).json({ error: "count must be an integer between 1 and 100" });
      return;
    }
    try {
      response.json(await sneaks.getMostPopular(count));
    } catch (error: unknown) {
      sendProviderError(response, error);
    }
  });

  router.get("/search/:shoe", async (request, response) => {
    const count = parseCount(request.query.count);
    if (count === undefined) {
      response.status(400).json({ error: "count must be an integer between 1 and 100" });
      return;
    }
    try {
      response.json(request.query.catalog === "true"
        ? await sneaks.getCatalogProducts(request.params.shoe, count)
        : await sneaks.getProducts(request.params.shoe, count));
    } catch (error: unknown) {
      sendProviderError(response, error);
    }
  });

  router.get("/id/:id/prices", async (request, response) => {
    try {
      response.json(await sneaks.getProductPrices(request.params.id.toUpperCase()));
    } catch (error: unknown) {
      sendProviderError(response, error);
    }
  });

  router.get("/id/:id/prices/:provider", async (request, response) => {
    const provider = request.params.provider;
    if (!["goat", "flightClub", "stadiumGoods", "stockX"].includes(provider)) {
      response.status(400).json({ error: "Unknown provider" });
      return;
    }
    try {
      response.json(await sneaks.getSellerPrices(request.params.id, provider as Retailer));
    } catch (error: unknown) {
      sendProviderError(response, error);
    }
  });

  return router;
}

export default createRoutes;
