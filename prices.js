const http = require('http');
const mysql = require('mysql2');
const axios = require('axios');
const ProgressBar = require('progress');
const puppeteer = require('puppeteer');
require('dotenv').config();

const hostname = '0.0.0.0';
const port = process.env.port || 3005;

const { fork } = require('child_process');
const { time } = require('console');
const platform = process.platform;
const bars = {};

const pricempire_api_key = process.env.PRICEMPIRE_API_KEY || '3d0fed5b-51a3-4a39-b366-20c2c1855a37'; // Your Priceempire.com key
const startingChilds = process.env.START_CHILDS || 3; // Count of Sources to start with, +1 every 2s
const restartTime = process.env.RESTART_TIME || 3600000; // Restarts script every 1h
const onlyPricehistory = process.env.ONLY_PRICEHISTORY || false; // FALSE // Skip getAllItems and just do pricehistorys (default=false)
const only30days = process.env.ONLY_30_DAYS || false; // FALSE
const delayBetweenRequests = 5000;
const colorMode = process.env.COLOR_MODE || true;

// Purple=Item Red=7day Yellow=14days Green=30days
let colors = {
    reset: '\033[0m',
    black: '\033[30m',
    red: '\033[31m',
    green: '\033[32m',
    yellow: '\033[33m',
    blue: '\033[34m',
    magenta: '\033[35m',
    cyan: '\033[36m',
    white: '\033[37m'
}
if (!colorMode) {
    colors = {
        reset: '', black: '', red: '', green: '', yellow: '', blue: '', magenta: '', cyan: '', white: ''
    }
}
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
        processSource();
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
  
const sources = [
  'buff', 'steam', 'csmoney', 'csgofloat', 'waxpeer', 'tradeit', 'skinport', 'bitskins', 'lootfarm', 'gamdom', 'csdeals', 'shadowpay', 'skinbaron', 'dmarket', 'gamerpay', 'csgoempire', 'swapgg', 'lootbear', 'skinwallet', 'mannco', 'lisskins', 'itemherald', 'buffmarket', 'skinsmonkey', 'csgoroll', 'cstrade', 'skinthunder', 'whitemarket', 'skinswap', 'nerf', 'c5game', 'skinbid', 'youpin'
];

//const ProgressBar = require('progress');
//const colors = require('colors');

async function processSource(source, connection) {
    const createTableQuery = `
        CREATE TABLE IF NOT EXISTS ${source} (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) UNIQUE,
            liquidity FLOAT,
            isInflated BOOLEAN,
            price FLOAT,
            count INT,
            popularity FLOAT,
            percentage FLOAT,
            percentage_7 FLOAT,
            percentage_14 FLOAT,
            percentage_30 FLOAT,
            price_history_7 JSON,
            price_history_14 JSON,
            price_history_30 JSON,
            price_history_7_dates JSON,
            price_history_14_dates JSON,
            price_history_30_dates JSON,
            createdAt DATETIME
        );
    `;
    connection.query(createTableQuery, function(error) {
        if (error) {
            console.error(error);
        }
    });

    const items = await fetchAllItems(source);
    if (!items) {
        console.error(colors.yellow+`Failed to fetch items for source ${source}`+colors.reset);
        return;
    }

    const itemsLength = Object.keys(items).length;
    const itemsProgressBar = new ProgressBar(colors.green+'Items: [:bar] :percent '+colors.magenta+source, {
        complete: '=',
        incomplete: ' ',
        width: 50,
        total: itemsLength,
    });

    if (!onlyPricehistory) {
        let index = 0;
        const itemKeys = Object.keys(items);
        for (const itemName in items) {
            index++;
            const item = items[itemName];
            const liquidity = item.liquidity;
            const sourceData = item[source];
    
            if (!sourceData) {
                continue;
            }

            const isInflated = sourceData.isInflated;
            const price = sourceData.price;
            const count = sourceData.count;
            const createdAt = sourceData.createdAt;
            const popularity = calculatePopularity(liquidity, count, price, 0);

            const query = `INSERT INTO ${source} (name, liquidity, isInflated, price, count, popularity, createdAt) VALUES ('${itemName.replace(/'/g, "''")}', ${liquidity}, ${isInflated}, ${price}, ${count}, ${popularity}, '${createdAt}') ON DUPLICATE KEY UPDATE liquidity = ${liquidity}, isInflated = ${isInflated}, price = ${price}, popularity = ${popularity}, count = ${count}, createdAt = '${createdAt}';`;

            connection.query(query, function (error, rows, fields) {
                if (error) {
                    console.error(error);
                } else {
                    itemsProgressBar.tick();
                }
            });
        }
    }
    await delay(delayBetweenRequests);
    const priceHistory7 = await fetchAllPrices(source, 7);
    await delay(delayBetweenRequests);
    const priceHistory14 = await fetchAllPrices(source, 14);
    await delay(delayBetweenRequests);
    const priceHistory30 = await fetchAllPrices(source, 30);

    if (!priceHistory7 || !priceHistory14 || !priceHistory30) {
        console.error(`Failed to fetch price history for source ${source}`);
        return;
    }
    
    const priceHistories = {
        7: { data: priceHistory7, progressBar: null },
        14: { data: priceHistory14, progressBar: null },
        30: { data: priceHistory30, progressBar: null },
    };

    for (const day in priceHistories) {
        const priceHistoryData = priceHistories[day].data;
        const priceHistoryLength = Object.keys(priceHistoryData).length;
        
        const progressBar = new ProgressBar(colors.green+`Price History ${day}: [:bar] :percent `+colors.magenta+source , {
            complete: '=',
            incomplete: ' ',
            width: 50,
            total: priceHistoryLength,
        });

        //console.log(priceHistoryData)

        priceHistories[day].progressBar = progressBar;

        const updateItemsPromises = [];

        for (const itemName in priceHistoryData) {
            updateItemsPromises.push(new Promise(async (resolve, reject) => {
                const selectQuery = `SELECT name, price, percentage_7, percentage_14, percentage_30 FROM ${source} WHERE name = '${itemName.replace(/'/g, "''")}'`;
                connection.query(selectQuery, async function (error, rows, fields) {
                    if (error) {
                        reject(error);
                    } else {
                        try {
                            const history = priceHistoryData[itemName];
        
                            const historyJSON = JSON.stringify(history);
                            const firstPrice = Object.values(history)[0];

                            //const firstPrice = history?.[0]?.[0];
                            
                            const currentPrice = rows[0]?.['price'];

                            //console.log(history, firstPrice, "+", currentPrice)
                            let percentage = (rows[0]?.['percentage_7'] + rows[0]?.['percentage_14'] + rows[0]?.['percentage_30']) / 3
                            let percentageChange; 
                            if (isNaN(percentage) || !isFinite(percentage)) {
                                percentage = 0;
                            }
                            if (firstPrice === 0 || isNaN(currentPrice)) {
                                percentageChange = 0;
                            } else {
                                percentageChange = (currentPrice / firstPrice - 1) * 100;
                                if (isNaN(percentageChange) || !isFinite(percentageChange)) {
                                    percentageChange = 0;
                                }
                            }

                            let prices = [];
                            let timestamps = [];
                            Object.entries(history).forEach(([timestamp, price]) => {
                                prices.push(price);
                                timestamps.push(timestamp);
                            });
                            
                            prices = JSON.stringify(prices);
                            timestamps = JSON.stringify(timestamps);

                            //console.log(prices, timestamps);
        
                            const query = `INSERT INTO ${source} (name, percentage, price_history_${day}, percentage_${day}, price_history_${day}_dates) VALUES ('${itemName.replace(/'/g, "''")}', '${percentage}', '${prices}', '${percentageChange}', '${timestamps}') ON DUPLICATE KEY UPDATE percentage = '${percentage}', price_history_${day} = '${prices}', price_history_${day}_dates = '${timestamps}', percentage_${day} = '${percentageChange}';`;
                            connection.query(query, function (error, rows, fields) {
                                if (error) {
                                    console.error(error);
                                } else {
                                    progressBar.tick();
                                    /*processPriceHistory([7, 14, 30], {
                                        7: priceHistory7,
                                        14: priceHistory14,
                                        30: priceHistory30,
                                    }, source, connection); */
                                    /*if (parseInt(day) === Math.max(...Object.keys(priceHistories))) {
                                        try {
                                            const item = getItem(itemName, ['bitskins', 'buff', 'buffmarket', 'csgofloat', 'dmarket', 'gamerpay', 'lisskins', 'shadowpay', 'skinbaron', 'skinport', 'skinsmonkey', 'steam', 'swapgg', 'tradeit', 'waxpeer', 'youpin']); // Add await here
                                            if (item) {
                                                processPriceHistory([7, 14, 30], {
                                                    7: priceHistory7,
                                                    14: priceHistory14,
                                                    30: priceHistory30,
                                                }, source, connection); 
                                            } else {
                                                console.error("Item not found.");
                                            } 
                                        } catch (error) {
                                            console.error("Error fetching item data:", error);
                                        }
                                    }*/
                                }
                            });
        
                        } catch (err) {
                            console.error(err);
                        }
                        resolve();
                    }
                });
            }));
        }
        Promise.all(updateItemsPromises).then(() => {
            // Code to be executed after all promises are resolved
            processPriceHistory([7, 14, 30], {
                7: priceHistory7,
                14: priceHistory14,
                30: priceHistory30,
            }, source, connection);
        }).catch((error) => {
            console.error("Error updating items:", error);
        });
            
        
    }
}


createPool();
const sourceArgument = process.argv[2];

// App starting here
if (sourceArgument && sources.includes(sourceArgument)) {
    processSource(sourceArgument, connection);
} else {
    // console.log(colors.green, `Starting with >> `+startingChilds+` << workers.\n`+colors.cyan+` Use '`+colors.magenta+`node price.js`+colors.cyan+` (SOURCE)' to update all (a specific) source(s): ${sources.join(', ')}`+colors.reset);
    //console.log(colors.blue+'Explanation: '+colors.magenta+'Purple: Item '+colors.red+'-> Red: Pricehistory_7 -> '+colors.yellow+'-> Yellow: Pricehistory_14 -> '+colors.green+'- Green: Pricehistory_30'+colors.reset);
    console.log("Spawning childs: "+colors.green)

    // Start marketplace processing
    startChilds(sources);
    // Restart script every X ms
    setInterval(() => {
        //createPool(); // necessary???
        console.log(colors.yellow, 'Restarting script after '+restartTime/100+' s');
        startChilds(sources);
    }, restartTime);
}

async function fetchAllItems(source) {
    const params = {
        api_key: pricempire_api_key,
        currency: 'USD',
        appId: 730,
        sources: source,
    };

    try {
        const response = await axios.get('https://api.pricempire.com/v3/getAllItems', {
            params,
            headers: {
                'Accept-Encoding': 'gzip'
            }
        });
        return response.data;
    } catch (error) {
        console.error("Error fetching all ITEMS:", error?.code, error?.response?.data?.message);
        return null;
    }
}
async function fetchAllPrices(source, days) {
    const params = {
        api_key: pricempire_api_key,
        currency: 'USD',
        days: days,
        source: source,
    };

    try {
        const response = await axios.get('https://api.pricempire.com/v3/getPriceHistories', {
            params,
            headers: {
                'Accept-Encoding': 'gzip'
            }
        });
        return response.data;
    } catch (error) {
        console.error("Error fetching all PRICES:", error?.code); //?.code
        return null;
    }
}

function getItem(name, marketplaces) {
    return new Promise((resolve, reject) => {
      const marketplaceJoins = marketplaces.map((marketplace) => `
        LEFT JOIN ${marketplace} ON s.name = ${marketplace}.name
      `).join('');
  
      const marketplaceSelect = marketplaces.map((marketplace, index) => `
        ${marketplace}.liquidity as ${marketplace}_liquidity,
        ${marketplace}.price as ${marketplace}_price,
        ${marketplace}.count as ${marketplace}_count,
        ${marketplace}.isInflated as ${marketplace}_isInflated,
        ${marketplace}.popularity as ${marketplace}_popularity,
        ${marketplace}.percentage_7 as ${marketplace}_percentage_7,
        ${marketplace}.percentage_14 as ${marketplace}_percentage_14,
        ${marketplace}.percentage_30 as ${marketplace}_percentage_30,
        ${marketplace}.percentage as ${marketplace}_percentage${index === marketplaces.length - 1 ? '' : ','}
      `).join('');
  
      const minPriceSubquery = marketplaces.map((marketplace) => `
        SELECT price FROM ${marketplace} WHERE name = ?
      `).join(' UNION ALL ');
  
      const query = `
        SELECT s.name, s.skin, s.gun_type, s.rarity, s.collection, s.weapon_type, s.price_avg, s.icon, ${marketplaceSelect},
            (SELECT MIN(price) FROM (${minPriceSubquery}) as min_prices) as lowest_price
        FROM skins s
        ${marketplaceJoins}
        WHERE s.name = ?;
        `;
  
      const queryParams = [...marketplaces.map(m => name), name];
  
      connection.query(query, queryParams, function (error, results) {
        if (error) reject(error);
  
        // Check if the result is not empty
        if (results?.length > 0) {
          const item = results[0];

            // Create an object with marketplaces and their prices
            const marketplacePrices = marketplaces.reduce((obj, marketplace) => {
                obj[marketplace] = item[marketplace + '_price'];
                return obj;
            }, {});

            // Find the marketplace with the lowest price
            const lowestPriceMarketplace = Object.keys(marketplacePrices).find(
                (marketplace) => marketplacePrices[marketplace] === item['lowest_price']
            );

            // Add the lowest_price_marketplace to the item
            item['lowest_price_marketplace'] = lowestPriceMarketplace;


          item['lowest_price'] = results[0]?.['lowest_price'];
          item['highest_price'] = results[0]?.['highest_price'];
          item['price_avg'] = results[0]?.['price_avg'];

          // Process each value for all marketplaces
          const fields = ['liquidity', 'price', 'count', 'popularity', 'percentage', 'percentage_7', 'percentage_14', 'percentage_30', 'isInflated'];
          fields.forEach((field) => {
            const values = marketplaces.map(m => item[m + '_' + field]).filter(v => v !== null);
            if (values.length > 0) {
              item[field + '_average'] = calculateAverage(values);
              item[field + '_median'] = calculateMedian(values);
            } else {
              item[field + '_average'] = null;
              item[field + '_median'] = null;
            }
          });
          //console.log('Item after processing:', item);
          resolve(item);
        } else {
          resolve(null);
        }
      });
    });
}

async function processPriceHistory(days, priceHistories, source, connection) {
    const colorsPricehistory = [colors.red, colors.yellow, colors.green];
    const startIndex = only30days ? 2 : 0;

    const queryAsync = (query) => {
        return new Promise((resolve, reject) => {
            connection.query(query, function (error, rows, fields) {
                if (error) reject(error);
                else resolve(rows);
            });
        });
    };

    for (let i = startIndex; i < days.length; i++) {
        const day = days[i];
        const priceHistory = priceHistories[day];

        for (const itemName in priceHistory) {
            const selectQuery = `SELECT name, price, percentage_7, percentage_14, percentage_30 FROM ${source} WHERE name = '${itemName.replace(/'/g, "''")}'`;
            try {
                const rows = await queryAsync(selectQuery);
                // Copied from Line 200
                const history = priceHistory[itemName];
                const historyJSON = JSON.stringify(history);
                const firstPrice = Object.values(history)[0];
                //const firstPrice = history?.[0];
                const currentPrice = rows?.[0]?.['price'];
                //console.log(firstPrice, currentPrice)
                //console.log(history, firstPrice, "-", currentPrice)
                //console.log(history)
                let percentage = (rows[0]?.['percentage_7'] + rows[0]?.['percentage_14'] + rows[0]?.['percentage_30']) / 3
                let percentageChange; 
                if (isNaN(percentage) || !isFinite(percentage)) {
                    percentage = 0;
                }
                if (firstPrice === 0 || isNaN(currentPrice)) {
                    percentageChange = 0;
                } else {
                    percentageChange = (currentPrice / firstPrice - 1) * 100;
                    if (isNaN(percentageChange) || !isFinite(percentageChange)) {
                        percentageChange = 0;
                    }
                }

                let prices = [];
                let timestamps = [];
                Object.entries(history).forEach(([timestamp, price]) => {
                    prices.push(price);
                    timestamps.push(timestamp);
                });

                const pricesString = JSON.stringify(prices);
                const timestampsString = JSON.stringify(timestamps);

                const query = `
                INSERT INTO ${source} (name, price_history_${day}, percentage_${day}, price_history_${day}_dates)
                VALUES ('${itemName.replace(/'/g, "''")}', '${pricesString}', ${percentageChange}, '${timestampsString}')
                ON DUPLICATE KEY UPDATE price_history_${day} = '${pricesString}', percentage_${day} = ${percentageChange}, price_history_${day}_dates = '${timestampsString}';
                `;
                
                await queryAsync(query);

                // This code block is checking if the current iteration index in a loop is equal to the last index of an array.
                if (i === days.length - 1) {
                    try {
                        // Calls the getItem function with specified parameters and awaits its response.
                        const item = await getItem(itemName, ['bitskins', 'buff', 'buffmarket', 'csgofloat', 'dmarket', 'gamerpay', 'lisskins', 'shadowpay', 'skinbaron', 'skinport', 'skinsmonkey', 'steam', 'swapgg', 'tradeit', 'waxpeer', 'youpin']);

                        // If the getItem function returns a truthy value, destructures relevant data from the response.
                        if (item) {
                            const {
                                lowest_price,
                                highest_price,
                                lowest_price_marketplace,
                                price_average,
                                price_median,
                                isInflated_average,
                                isInflated_median,
                                percentage_average,
                                percentage_median,
                                percentage_7_average,
                                percentage_7_median,
                                percentage_14_average,
                                percentage_14_median,
                                percentage_30_average,
                                percentage_30_median
                            } = item;

                            // Calculates the discounts based on price data and normalizes them to a range of -25 to 25.
                            const discount_avg = (lowest_price / price_average - 1) * 100;
                            const discount_med = (lowest_price / price_median - 1) * 100;
                            const discount = (discount_avg * 3 + discount_med) / 4;
                            //console.log(item)
                            const normalizedDiscount = normalize(discount, -100, 100, -25, 100);

                            // Constructs an SQL query string with updated values for a database table row.
                            const updateQuery = `
                            UPDATE skins
                            SET discount = ${normalizedDiscount || 0},
                                discount_avg = ${discount_avg || 0},
                                discount_med = ${discount_med || 0},
                                popularity_avg = ${item.popularity_average || 0},
                                popularity_med = ${item.popularity_median || 0},
                                lowest_price = ${lowest_price || 0},
                                highest_price = ${lowest_price || 0},
                                lowest_price_marketplace = '${item.lowest_price_marketplace || 'Unknown'}',
                                price_avg = ${item.price_average || 0},
                                price_med = ${item.price_median || 0},
                                count_avg = ${item.count_average || 0},
                                count_med = ${item.count_median || 0},
                                liquidity_avg = ${item.liquidity_average || 0},
                                liquidity_med = ${item.liquidity_median || 0},
                                percentage_avg = ${(item.percentage_7_average + item.percentage_14_average + item.percentage_30_average) / 3 || 0},
                                percentage_med = ${(item.percentage_7_median + item.percentage_14_median + item.percentage_30_median) / 3 || 0},
                                percentage_7_avg = ${item.percentage_7_average || 0},
                                percentage_7_med = ${item.percentage_7_median || 0},
                                percentage_14_avg = ${item.percentage_14_average || 0},
                                percentage_14_med = ${item.percentage_14_median || 0},
                                percentage_30_avg = ${item.percentage_30_average || 0},
                                percentage_30_med = ${item.percentage_30_median || 0},
                                isInflated_avg = ${isInflated_average || 0},
                                isInflated_med = ${isInflated_median || 0}
                            WHERE name = '${itemName.replace(/'/g, "''")}'`;

                            // Calls an asynchronous function to execute the SQL query.
                            await queryAsync(updateQuery);
                        }
                    } catch (error) {
                        // Logs an error message to the console if an error occurs.
                        console.error("Error fetching item data:", error);
                    }
                }

            } catch (error) {
                console.error(error);
            }
        }
    }
}

function startChilds(sources) { 
    sources.forEach((source, index) => {
      // Create a progress bar for each source
      const bar = new ProgressBar(`${source} [:bar] :percent`, {
        complete: '=',
        incomplete: ' ',
        width: 20,
        total: 100
      });
  
      // Simulate progress updates for demonstration purposes
      const interval = setInterval(() => {
        bar.tick();
        if (bar.complete) {
          clearInterval(interval);
        }
      }, 100);
    });
  }

function calculatePopularity(liquidity, count, price, percentage) {
    // Normalization (converting input values to a scale of 0 to 1)
    const maxLiquidity = 100; // Define the maximum liquidity you expect
    const maxCount = 75000; // Define the maximum count you expect
    const maxPrice = 15000000; // Define the maximum price you expect
    const maxPercentage = 100; // Define the maximum percentage you expect

    const normalizedLiquidity = liquidity / maxLiquidity;
    const normalizedCount = count / maxCount;
    const normalizedPrice = price / maxPrice;
    const normalizedPercentage = percentage / maxPercentage;

    // Weights
    const liquidityWeight = 0.8;
    const countWeight = 0.5;
    const priceWeight = 0.35;
    const percentageWeight = 0.1;

    // Calculate weighted values
    const weightedLiquidity = normalizedLiquidity * liquidityWeight;
    const weightedCount = normalizedCount * countWeight;
    const weightedPrice = normalizedPrice * priceWeight;
    const weightedPercentage = normalizedPercentage * percentageWeight;

    // Calculate the popularity
    let popularity = (weightedLiquidity + weightedCount + weightedPrice + weightedPercentage) * 100;
    if (!isFinite(popularity)) {
        popularity = 0;
    }
    return popularity;
}

function calculateAverage(arr) {
    return arr.reduce((acc, cur) => acc + cur, 0) / arr.length;
}

function calculateMedian(arr) {
    const sorted = arr.sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);

    return sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalize(value, oldMin, oldMax, newMin, newMax) {
    return ((value - oldMin) / (oldMax - oldMin)) * (newMax - newMin) + newMin;
}

/* const server = http.createServer((req, res) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Hello World\n');
});
server.listen(port, hostname, () => {
    console.log(`Server running at http://${hostname}:${port}/`);
}); */