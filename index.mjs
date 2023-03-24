import express from "express";
import routes from "./routes/sneaks.routes.mjs";
import dotenv from "dotenv";
import SneaksAPI from "./controllers/sneaks.controllers.mjs";
import serverless from "serverless-http";

dotenv.config();
export const app = express();
export const router = express.Router();
routes();

// Use the router to handle requests to the `/.netlify/functions/api` path
app.use(`/.netlify/functions/api`, router);

export { SneaksAPI };
export const handler = serverless(app);
