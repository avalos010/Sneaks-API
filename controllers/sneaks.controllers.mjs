// import Sneaker from "../models/Sneaker";
import stockXScraper from "../scrapers/stockx-scraper.mjs";
import flightClubScraper from "../scrapers/flightclub-scraper.mjs";
import goatScraper from "../scrapers/goat-scraper.mjs";
import stadiumGoodsScraper from "../scrapers/stadiumgoods-scraper.mjs";

class SneaksAPI {
  async getProducts(keyword, count = 40, callback) {
    var productCounter = 0;
    stockXScraper.getProductsAndInfo(
      keyword,
      count,
      function (error, products) {
        if (error) {
          callback(error, null);
        }
        products.forEach(function (shoe) {
          var cbCounter = 0;
          flightClubScraper.getLink(shoe, function () {
            if (++cbCounter == 3) {
              //if all shoes links have been parsed then return
              if (productCounter++ + 1 == products.length) {
                callback(null, products);
              }
            }
          });

          stadiumGoodsScraper.getLink(shoe, function () {
            if (++cbCounter == 3) {
              //if all shoes links have been parsed then return
              if (productCounter++ + 1 == products.length) {
                callback(null, products);
              }
            }
          });

          goatScraper.getLink(shoe, function () {
            if (++cbCounter == 3) {
              //if all shoes links have been parsed then return
              if (productCounter++ + 1 == products.length) {
                callback(null, products);
              }
            }
          });
        });
      }
    );
  }

  getProductPrices(shoeID, callback) {
    const getPrices = (shoe) => {
      var cbCounter = 0;
      stockXScraper.getPrices(shoe, function () {
        cbCounter++;
        if (cbCounter == 5) {
          callback(null, shoe);
        }
      });
      stadiumGoodsScraper.getPrices(shoe, function () {
        cbCounter++;
        if (cbCounter == 5) {
          callback(null, shoe);
        }
      });
      flightClubScraper.getPrices(shoe, function () {
        cbCounter++;
        if (cbCounter == 5) {
          callback(null, shoe);
        }
      });
      goatScraper.getPrices(shoe, function () {
        cbCounter++;
        if (cbCounter == 5) {
          callback(null, shoe);
        }
      });
      goatScraper.getPictures(shoe, function () {
        cbCounter++;
        if (cbCounter == 5) {
          callback(null, shoe);
        }
      });
    };

    getProducts(shoeID, 1, function (error, products) {
      if (error || products[0].styleID.toLowerCase() != shoeID.toLowerCase()) {
        console.log(new Error("No Products Found"));
        callback(new Error("No Products Found"), null);
        return;
      }
      getPrices(products[0]);
    });
  }

  /*findAll(callback) {
    Sneaker.find()
      .then(sneaks => {
        callback(null, sneaks);
      }).catch(err => {
        callback(err, null)
      });
  };*/

  getMostPopular(count, callback) {
    getProducts("", count, function (error, products) {
      if (error) {
        callback(error, null);
      } else {
        callback(null, products);
      }
    });
  }
}

var getProducts = function (keyword, count = 40, callback) {
  var productCounter = 0;
  stockXScraper.getProductsAndInfo(keyword, count, function (error, products) {
    if (error) {
      callback(error, null);
    }
    products.forEach(function (shoe) {
      var cbCounter = 0;
      flightClubScraper.getLink(shoe, function () {
        if (++cbCounter == 3) {
          //if all shoes links have been parsed then return
          if (productCounter++ + 1 == products.length) {
            callback(null, products);
          }
        }
      });

      stadiumGoodsScraper.getLink(shoe, function () {
        if (++cbCounter == 3) {
          //if all shoes links have been parsed then return
          if (productCounter++ + 1 == products.length) {
            callback(null, products);
          }
        }
      });

      goatScraper.getLink(shoe, function () {
        if (++cbCounter == 3) {
          //if all shoes links have been parsed then return
          if (productCounter++ + 1 == products.length) {
            callback(null, products);
          }
        }
      });
    });
  });
};

export default SneaksAPI;
