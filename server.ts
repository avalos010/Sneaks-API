import { app } from "./index.js";

const port = Number(process.env.PORT ?? 4000);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error("PORT must be an integer between 0 and 65535");
}

app.listen(port, () => {
  console.log(`Sneaks API listening on port ${port}`);
});
