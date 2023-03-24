import SneaksAPI from "../controllers/sneaks.controllers.mjs";
import { router } from "../index.mjs";
const sneaks = new SneaksAPI();

const routes = () => {
  router.use(function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header(
      "Access-Control-Allow-Headers",
      "Origin, X-Requested-With, Content-Type, Accept"
    );
    next();
  });

  router.get("/", (req, res) => {
    res.send("Hello World");
  });

  //grabs the most popular sneakers
  router.get("/popular", function (req, res) {
    const count = req.query.count || 40; // if the user doesn't provide the query param, it defaults to 40
    sneaks.getMostPopular(count, function (error, products) {
      try {
        res.json(products);
      } catch (error) {
        console.error(error);
        res.json({ error: "Product Not Found" });
      }
    });
  });

  //Grabs all sneakers given a keyword/parameter
  router.get("/search/:shoe", function (req, res) {
    const count = req.query.count || 40; // if the user doesn't provide the query param, it defaults to 40
    sneaks.getProducts(req.params.shoe, count, function (error, products) {
      if (error) {
        console.log(error);
        res.json({ error: "Product Not Found" });
      } else {
        res.json(products);
      }
    });
  });

  //redirects root route to popular by default
  router.get("/", function (req, res) {
    res.redirect("/popular");
  });

  //Grabs price maps from each site of a particular shoe
  router.get("/id/:id/prices", function (req, res) {
    sneaks.getProductPrices(
      req.params.id.toUpperCase(),
      function (error, products) {
        if (error) {
          console.log(error);
          res.json({ error: "Product Not Found" });
        } else {
          res.json(products);
        }
      }
    );
  });
};

export default routes;
