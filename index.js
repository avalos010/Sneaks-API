import express from "express";
import mongoose from "mongoose";
import routes from "./routes/sneaks.routes.js";
import dotenv from "dotenv";
import SneaksAPI from "./controllers/sneaks.controllers.js";

dotenv.config();
export const app = express();
routes(app);

var port = process.env.PORT || 4000;
mongoose.Promise = global.Promise;

app.listen(port, function () {
  console.log(`Sneaks app listening on port `, port);
});

export { SneaksAPI };
