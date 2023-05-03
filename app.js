// Importing required packages/modules
const http = require("http");
const mysql = require("mysql2");
const axios = require("axios");
const ProgressBar = require("progress");
//const puppeteer = require('puppeteer');
require("dotenv").config();

// The port number that the server should listen on
const hostname = "0.0.0.0";
const port = process.env.PORT || 3003;

// API key for the Steam APIs service
const steamapis_key =
  process.env.STEAMAPIS_KEY || "YEyRd9rkFI2DhXV-1_uLFyfznpA";

// Whether to skip fetching backpack/profile data (default: false)
const skip_backpack = process.env.SKIP_BACKPACK || true;

// Whether to run in fast mode (default: true) - Timeout between steamapis.com requests in ms.
// For PRO plan: 61ms for maximum speed, but 1730ms for 24/7 use to not exceed 50000 requests/day limit
const fast_mode = process.env.FAST_MODE || true;

// Whether to enable color mode (default: true)
const colorMode = process.env.COLOR_MODE || true;

let timeout = fast_mode ? 61 : 1730; // Determines the request timeout in ms
const config = {
  host: process.env.MYSQL_HOST || "localhost",
  user: process.env.MYSQL_USER || "admin",
  password: process.env.MYSQL_PASSWORD || "admin",
  database: process.env.MYSQL_DATABASE || "hfsvmsnrex",
  waitForConnections: true,
  connectionLimit: 50,
  queueLimit: 0,
  connectTimeout: 420000,
};

let DB = null;
function createPool() {
  DB = mysql.createPool(config);

  DB.getConnection((err, connection) => {
    if (err) {
      console.error("Database error:", err);
      console.log("Recreating connection pool in 5s");
      closePool();
      setTimeout(createPool, 5000);
      main();
      return;
    }
    console.log("Database connected");
    connection.release();
  });

  DB.on("error", async (err) => {
    console.error("Database error:", err);
    if (err.code === "PROTOCOL_CONNECTION_LOST") {
      console.log("Recreating connection pool in 5s");
      closePool();
      await delay(5000);
      createPool();
      main();
    }
  });
}

function closePool() {
  if (DB) {
    DB.end((err) => {
      if (err) {
        console.error("Error closing the connection pool:", err);
      } else {
        console.log("Connection pool closed");
      }
    });
  }
}
createPool();

let colors = {
  reset: "\033[0m",
  black: "\033[30m",
  red: "\033[31m",
  green: "\033[32m",
  yellow: "\033[33m",
  blue: "\033[34m",
  magenta: "\033[35m",
  cyan: "\033[36m",
  white: "\033[37m",
};
if (!colorMode) {
  colors = {
    reset: "",
    black: "",
    red: "",
    green: "",
    yellow: "",
    blue: "",
    magenta: "",
    cyan: "",
    white: "",
  };
}

function queryPromise(sql, values = []) {
  return new Promise((resolve, reject) => {
    DB.query(sql, values, (error, results) => {
      if (error) {
        reject(error);
      } else {
        resolve(results);
      }
    });
  });
}

async function fetchSteamApisData() {
  try {
    const steamApisResponse = await queryPromise("SELECT name FROM skins;");

    console.log(
      "steamapis.com request starting for " +
        steamApisResponse.length +
        " requests"
    );

    const progressBar = new ProgressBar(
      colors.green +
        "  fetching [:bar] :percent " +
        colors.cyan +
        "- Remaining: :etas" +
        colors.reset,
      {
        complete: "=",
        incomplete: " ",
        width: 50,
        total: steamApisResponse.length,
      }
    );

    for (let i = 0; i < steamApisResponse.length; i++) {
      const item = steamApisResponse[i];

      setTimeout(async () => {
        try {
          const item_name = item.name.replace(/%27/g, "'");
          const encodedName = encodeURIComponent(item_name);
          const response = await axios.get(
            "https://api.steamapis.com/market/item/730/" +
              encodedName +
              "?api_key=" +
              steamapis_key +
              "&median_history_days=365"
          );

          if (response.status == 200) {
            //console.log(colors.green, item_name);

            let sql = "";

            let days = [];
            let prices = [];
            let amount = [];
            response.data.median_avg_prices_365days.forEach((data, index) => {
              if (
                index === 0 ||
                index === response.data.median_avg_prices_365days.length - 1
              ) {
                days.push(data[0]);
              }
              prices.push(Number(data[1].toFixed(2)));
              amount.push(data[2]);
            });

            let icon_url = response.data.image.split("/image/");
            let icon =
              icon_url[1]; /*SERVERS CAN BE DIFFERENT BUT FULL URL NOT WORKING*/
            //let icon = response?.data?.image;
            if (icon.length < 10) {
              console.error("Error: ");
            } else {
              let tags = response?.data?.assetInfo?.tags;
              let assets = response?.data?.assets?.descriptions;
              //console.log(tags)
              if (tags.length == 0) {
                let collection;
                assets.forEach((data) => {
                  if (
                    data.value.includes("The") &&
                    data.value.includes("Collection")
                  ) {
                    collection = data.value;
                    sql += ', collection = "' + collection + '"';
                  }
                });
                if (!collection) {
                  sql += ', collection = "undefined"';
                }
                let updateQuery = `UPDATE skins SET icon = ?, steam365_prices = ?, steam365_amount = ?, firstDate = ?, lastDate = ?  ${sql} WHERE name = ?;`;
                DB.query(
                  updateQuery,
                  [
                    icon,
                    JSON.stringify(prices),
                    JSON.stringify(amount),
                    days[0],
                    days[1],
                    item.name,
                  ],
                  function (error, rows, fields) {
                    if (error) {
                      console.error(error);
                    }
                  }
                );
              }

              if (tags.length >= 1) {
                tags.forEach(function (i, l) {
                  if (i.name.length > 0) {
                    if (i.category == "Rarity") {
                      let rarity = i.name;
                      sql += ', rarity = "' + rarity + '"';
                    }
                    if (i.category == "Exterior") {
                      let exterior = i.name;
                      sql += ', exterior = "' + exterior + '"';
                    }
                    if (
                      i.category == "ItemSet" ||
                      i.category == "StickerCapsule"
                    ) {
                      let collection = i.name;
                      sql += ', collection = "' + collection + '"';
                      //console.log(collection)
                    }
                    if (i.category == "Weapon") {
                      let gun_type = i.name;
                      sql += ', gun_type = "' + gun_type + '"';
                    }
                    if (i.category == "Type") {
                      var weapon_type = i.name;
                      sql += ', weapon_type = "' + weapon_type + '"';
                    }
                  }
                  if (l == tags.length - 1) {
                    /*if (collection.contains(', collection = "undefined') AND ) {
                                            sql+=', collection = "undefined"';
                                        } */
                    let updateQuery = `UPDATE skins SET icon = ?, steam365_prices = ?, steam365_amount = ?, firstDate = ?, lastDate = ? ${sql} WHERE name = ?;`;
                    DB.query(
                      updateQuery,
                      [
                        icon,
                        JSON.stringify(prices),
                        JSON.stringify(amount),
                        days[0],
                        days[1],
                        item.name,
                      ],
                      function (error, rows, fields) {
                        if (error) {
                          console.error(error);
                        }
                      }
                    );
                  }
                });
              }
            }
          } else {
            console.log("No data found");
          }
        } catch (error) {
          const missingData = {
            "Souvenir AK-47 | Gold Arabesque (Factory New)":
              "The Italy Collection",
            "Souvenir AK-47 | Gold Arabesque (Minimal Wear)":
              "The Italy Collection",
            "Souvenir AUG | Condemned (Factory New)": "The Overpass Collection",
            "Souvenir AWP | Desert Hydra (Factory New)":
              "The Canals Collection",
            "Souvenir AWP | Dragon Lore (Battle-Scarred)":
              "The Cobblestone Collection",
            "Souvenir AWP | Dragon Lore (Factory New)":
              "The Cobblestone Collection",
            "Souvenir AWP | Dragon Lore (Field-Tested)":
              "The Cobblestone Collection",
            "Souvenir AWP | Dragon Lore (Minimal Wear)":
              "The Cobblestone Collection",
            "Souvenir AWP | Dragon Lore (Well-Worn)":
              "The Cobblestone Collection",
            "Souvenir AWP | Pit Viper (Battle-Scarred)":
              "The Mirage Collection",
            "Souvenir AWP | Safari Mesh (Factory New)": "The Dust Collection",
            "Souvenir Desert Eagle | Mudder (Factory New)":
              "The Vertigo Collection",
            "Souvenir Dual Berettas | Cobalt Quartz (Well-Worn)":
              "The Cache Collection",
            "Souvenir FAMAS | Cyanospatter (Factory New)":
              "The Nuke Collection",
            "Souvenir M4A1-S | Imminent Danger (Factory New)":
              "The Train Collection",
            "Souvenir M4A1-S | Imminent Danger (Minimal Wear)":
              "The Train Collection",
            "Souvenir M4A1-S | Imminent Danger (Well-Worn)":
              "The Train Collection",
            "Souvenir M4A1-S | Nitro (Factory New)": "The Mirage Collection",
            "Souvenir M4A1-S | Welcome to the Jungle (Factory New)":
              "The Canals Collection",
            "Souvenir M4A1-S | Welcome to the Jungle (Minimal Wear)":
              "The Canals Collection",
            "Souvenir MP9 | Orange Peel (Factory New)":
              "The Overpass Collection",
            "Souvenir P2000 | Granite Marbleized (Factory New)":
              "The Dust Collection",
            "Souvenir P250 | Nuclear Threat (Factory New)":
              "The Nuke Collection",
            "Souvenir Tec-9 | Nuclear Threat (Factory New)":
              "The Nuke Collection",
            "Souvenir USP-S | Forest Leaves (Factory New)":
              "The Vertigo Collection",
          };

          if (missingData.hasOwnProperty(item.name)) {
            console.log(
              colors.yellow,
              item.name + "Failed but collection found."
            );
            const collection = missingData[item.name];
            let updateMissingCollection = `UPDATE skins SET collection = ? WHERE name = ?;`;
            DB.query(
              updateMissingCollection,
              [collection, item.name],
              function (error, rows, fields) {
                if (error) {
                  console.error(error);
                }
              }
            );
          } else {
            console.error(colors.red, item.name + " Error: " + error);
          }
        }

        progressBar.tick();
        if (i === steamApisResponse.length - 1) {
          console.log("steamapis.com request done for " + i + " requests");
          let updateStatTrak = `UPDATE skins SET is_stattrak = 1 WHERE name LIKE '%StatTrak%';`;
          DB.query(updateStatTrak, function (error, rows, fields) {
            if (error) {
              console.error(error);
            }
          });
          main();
          //await fetchSteamApisData();
        }
      }, i * timeout);
    }
  } catch (error) {
    console.error("SQL SELECT Error!" + error);
  }
}

function main() {
  console.log("Started query");
  const createTableQuery = `CREATE TABLE IF NOT EXISTS skins (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) UNIQUE,
        gun_type VARCHAR(20),
        skin VARCHAR(120),
        rarity VARCHAR(25),
        exterior VARCHAR(25),            
        weapon_type VARCHAR(30),
        collection VARCHAR(70),
        discount FLOAT NOT NULL,
        discount_avg FLOAT NOT NULL,
        discount_med FLOAT NOT NULL,
        price_avg FLOAT,
        popularity_avg FLOAT,
        count_avg INT,
        liquidity_avg FLOAT,
        isInflated_avg FLOAT,
        isInflated_med FLOAT,
        lowest_price FLOAT,
        lowest_price_marketplace VARCHAR(22),
        highest_price FLOAT,
        steam30_avg FLOAT,
        steam30_sold INT,
        rating FLOAT,
        rating_count INT,
        is_stattrak TINYINT(1) NOT NULL,
        icon VARCHAR(350),
        percentage_7_avg FLOAT,
        percentage_14_avg FLOAT,
        percentage_30_avg FLOAT,
        percentage_avg FLOAT,
        price_med FLOAT,
        count_med INT,
        liquidity_med FLOAT,
        percentage_7_med FLOAT,
        percentage_14_med FLOAT,
        percentage_30_med FLOAT,
        percentage_med FLOAT,
        popularity_med FLOAT,
        steam365_prices JSON,
        steam365_amount JSON,
        firstDate VARCHAR(20),    
        lastDate VARCHAR(20));`;

  DB.query(createTableQuery, async function (error, result) {
    if (error) {
      console.error("Error creating skins table:", error);
    } else {
      console.log(
        colors.cyan +
          "skins" +
          colors.green +
          " table initialized." +
          colors.reset
      );

      const createCsgoBackpackTableQuery = `CREATE TABLE IF NOT EXISTS csgobackpack (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(100) UNIQUE,
                1_avg FLOAT,
                1_median FLOAT,
                1_sold INT,
                1_standard_deviation FLOAT,
                1_lowest_price FLOAT,
                1_highest_price FLOAT,
                7_avg FLOAT,
                7_median FLOAT,
                7_sold INT,
                7_standard_deviation FLOAT,
                7_lowest_price FLOAT,
                7_highest_price FLOAT,
                30_avg FLOAT,
                30_median FLOAT,
                30_sold INT,
                30_standard_deviation FLOAT,
                30_lowest_price FLOAT,
                30_highest_price FLOAT,
                alltime_avg FLOAT,
                alltime_median FLOAT,
                alltime_sold INT,
                alltime_standard_deviation FLOAT,
                alltime_lowest_price FLOAT,
                alltime_highest_price FLOAT);`;
      DB.query(createCsgoBackpackTableQuery, async function (error, result) {
        if (error) {
          console.error("Error creating csgobackpack table:", error);
        } else {
          console.log(
            colors.cyan +
              "Color Cyan: csgobackpack" +
              colors.green +
              " table initialized." +
              colors.reset
          );
          // Import puppeteer-extra and the stealth plugin
          const puppeteer = require("puppeteer-extra");
          const StealthPlugin = require("puppeteer-extra-plugin-stealth");

          // Add the stealth plugin to puppeteer-extra
          puppeteer.use(StealthPlugin());
          // CSGOBACKPACK.net REQUEST
          try {
            const browser = await puppeteer.launch({
              args: ["--no-sandbox", "--disable-setuid-sandbox"], // , executablePath: process.env.CHROME_BIN || null,
            });
            const page = await browser.newPage();

            await page.setJavaScriptEnabled(true);
            await page.setUserAgent(
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36"
            );

            await page.goto(
              "http://csgobackpack.net/api/GetItemsList/v2/?key=ngwukxmcgae5zgpp",
              { waitUntil: "networkidle2", timeout: 720000 }
            );

            await page.waitForTimeout(12000); // Wait for 12 seconds
            const responseBody = await page.evaluate(
              () => document.body.textContent
            );
            console.log("Passed:CSGOBackpack API response body:");
            // console.log("Passed:CSGOBackpack API response body:", responseBody);
            let response;
            try {
              response = JSON.parse(responseBody);
            //   console.log("Response:", response);
            } catch (error) {
              console.error("Error parsing CSGOBackpack API response:", error);
              await browser.close();
              return;
            }
            console.log(responseBody.slice(0, 3));

            console.log("CSGOBackpack API response:");
            // console.log("CSGOBackpack API response:", response);

            if (response.success == true) {
              var items = response?.items_list;

              if (!items) {
                console.error("Items list is undefined or null.");
                return;
              }

              var data = Object.values(items);
              console.log(data)

              console.log(
                "CSGOBackpack API request started for " +
                  data.length +
                  " requests"
              ); 
              const csgoBackpackPromises = [];
              for (var i = 0; i <= data.length - 1; i++) {
                if (skip_backpack) {
                  i = data.length - 1;
                }

                var item = Object.values(items)[i];
                var output = item.name
                  .replace(" (Factory New)", "")
                  .replace(" (Minimal Wear)", "")
                  .replace(" (Field-Tested)", "")
                  .replace(" (Well-Worn)", "")
                  .replace(" (Battle-Scarred)", "");
                if (
                  output.includes("Sticker") ||
                  output.includes("Graffiti") ||
                  /Distinguished|Exceptional|Superior|Master/.test(item.rarity)
                ) {
                  var skin = output.replace(/&#39/g, "'");
                } else {
                  var skin = output
                    .split(/[|]+/)
                    .pop()
                    .trim()
                    .replace(/&#39/g, "'");
                }
                //console.log(items)
                // INSERT INFO DATA into skins table
                const promise = queryPromise(
                  `INSERT INTO skins (
                                name, gun_type, skin, rarity, exterior, icon, weapon_type, steam30_avg, steam30_sold, discount,discount_avg,discount_med,is_stattrak) VALUES (
                                ?, ?, ?, ?, ?, ?, ?, ?, ?,?,?,?,?
                                ) ON DUPLICATE KEY UPDATE
                                name=VALUES(name), gun_type=VALUES(gun_type), skin=VALUES(skin), rarity=VALUES(rarity), exterior=VALUES(exterior), icon=VALUES(icon), steam30_avg=VALUES(steam30_avg), steam30_sold=VALUES(steam30_sold);
                                `,
                  [
                    item.name.replace(/&#39/g, "'"),
                    item.gun_type,
                    skin,
                    item.rarity,
                    item.exterior,
                    item.icon_url,
                    item.type,
                    item?.price?.["24_hours"]?.average,
                    item?.price?.["24_hours"]?.sold,
                    item?.price?.["7_days"]?.average,
                    item?.price?.["7_days"]?.sold,
                    item?.price?.["30_days"]?.average,
                    item?.price?.["30_days"]?.sold,
                    item?.price?.["30_days"]?.average,
                    item?.price?.["30_days"]?.sold,
                  ]
                );
                csgoBackpackPromises.push(promise);

                // INSERT PRICE DATA into csgobackpack table
                const pricePromise = queryPromise(
                  `
                                INSERT INTO csgobackpack (
                                    name, 1_avg, 1_median, 1_sold, 1_standard_deviation, 1_lowest_price, 1_highest_price,
                                    7_avg, 7_median, 7_sold, 7_standard_deviation, 7_lowest_price, 7_highest_price,
                                    30_avg, 30_median, 30_sold, 30_standard_deviation, 30_lowest_price, 30_highest_price,
                                    alltime_avg, alltime_median, alltime_sold, alltime_standard_deviation, alltime_lowest_price, alltime_highest_price
                                ) VALUES (
                                    ?,
                                    ?, ?, ?, ?, ?, ?,
                                    ?, ?, ?, ?, ?, ?,
                                    ?, ?, ?, ?, ?, ?,
                                    ?, ?, ?, ?, ?, ?
                                ) ON DUPLICATE KEY UPDATE
                                    1_avg=VALUES(1_avg), 1_median=VALUES(1_median), 1_sold=VALUES(1_sold),
                                    1_standard_deviation=VALUES(1_standard_deviation), 1_lowest_price=VALUES(1_lowest_price), 1_highest_price=VALUES(1_highest_price),
                                    7_avg=VALUES(7_avg), 7_median=VALUES(7_median), 7_sold=VALUES(7_sold),
                                    7_standard_deviation=VALUES(7_standard_deviation), 7_lowest_price=VALUES(7_lowest_price), 7_highest_price=VALUES(7_highest_price),
                                    30_avg=VALUES(30_avg), 30_median=VALUES(30_median), 30_sold=VALUES(30_sold),
                                    30_standard_deviation=VALUES(30_standard_deviation), 30_lowest_price=VALUES(30_lowest_price), 30_highest_price=VALUES(30_highest_price),
                                    alltime_avg=VALUES(alltime_avg), alltime_median=VALUES(alltime_median), alltime_sold=VALUES(alltime_sold),
                                    alltime_standard_deviation=VALUES(alltime_standard_deviation), alltime_lowest_price=VALUES(alltime_lowest_price), alltime_highest_price=VALUES(alltime_highest_price);
                                `,
                  [
                    item.name.replace(/&#39/g, "'"),
                    item?.price?.["24_hours"]?.average,
                    item?.price?.["24_hours"]?.median,
                    item?.price?.["24_hours"]?.sold,
                    item?.price?.["24_hours"]?.standard_deviation,
                    item?.price?.["24_hours"]?.lowest_price,
                    item?.price?.["24_hours"]?.highest_price,
                    item?.price?.["7_days"]?.average,
                    item?.price?.["7_days"]?.median,
                    item?.price?.["7_days"]?.sold,
                    item?.price?.["7_days"]?.standard_deviation,
                    item?.price?.["7_days"]?.lowest_price,
                    item?.price?.["7_days"]?.highest_price,
                    item?.price?.["30_days"]?.average,
                    item?.price?.["30_days"]?.median,
                    item?.price?.["30_days"]?.sold,
                    item?.price?.["30_days"]?.standard_deviation,
                    item?.price?.["30_days"]?.lowest_price,
                    item?.price?.["30_days"]?.highest_price,
                    item?.price?.all_time?.average,
                    item?.price?.all_time?.median,
                    item?.price?.all_time?.sold,
                    item?.price?.all_time?.standard_deviation,
                    item?.price?.all_time?.lowest_price,
                    item?.price?.all_time?.highest_price,
                  ]
                );
                csgoBackpackPromises.push(pricePromise);
              }
              // Wait for all promises to complete before continuing
              await Promise.all(csgoBackpackPromises);
              console.log("CSGOBackpack API request completed.");
              await fetchSteamApisData();

              await browser.close();
            } else {
              console.log("CSGOBackpack API request failed.");
              await browser.close();
            }
          } catch (error) {
            console.error("CSGOBackpack API request error:", error);
            if (error.code === "PROTOCOL_CONNECTION_LOST") {
              await delay(7000);
              //closePool();
              createPool();
              main();
            } else {
              // Handle other types of errors, if needed
              await delay(7000);
              //closePool();
              createPool();
              main();
            }
          }
        }
      });
    }
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const server = http.createServer((req, res) => {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/plain");
  res.end("Ready\n");
});

server.listen(port, hostname, () => {
  console.log(`Server running at http://${hostname}:${port}/`);
  main(); // Call the `main` function to start the program
});
