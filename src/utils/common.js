const fs = require('fs');
const axios = require('axios');

const { Client } = require("@notionhq/client");
const {
    dbinit,
    dbinsert,
    dbfind,
    dbthis
} = require('./db.js');

// Max queries per second: 3
const rate_limit_delay = 335;
const rate_limit_reached_delay_min = 5;
const rate_limit_reached_delay = rate_limit_reached_delay_min * 60 * 1000;
const general_api_error_delay_min = 1;
const general_api_error_delay = general_api_error_delay_min * 60 * 1000;

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const logToFile = (logFile, message) => {
    fs.appendFileSync(logFile, `${new Date().toISOString()} - ${message}\n`);
};

function now(ms = false) {
    const date = new Date();
    if (ms) {
        return date.toISOString();
    } else {
        return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
    }
};

const fetchWithRetries = async (url, options, logFile, verbose, maxRetries) => {
    let retries = 0;
    while (retries < maxRetries) {
        try {
            const response = await axios({
                method: options.method,
                url,
                headers: options.headers,
                data: options.body,
                validateStatus: () => true, // Accept all HTTP status codes
            });

            logToFile(logFile, `HTTP Status: ${response.status}`);
            if (verbose) console.log(`HTTP Status: ${response.status}`);

            if (response.status === 429) {
                const message = `Rate limit exceeded - waiting for ${rate_limit_reached_delay_min} minutes before retrying`;
                logToFile(logFile, message);
                console.log(now() + message);
                await delay(rate_limit_reached_delay); // Wait for 10 minutes before retrying
                console.log(now() + ': Retrying');
                retries++;
                continue; // Retry the request
            }

            return {
                ok: response.status >= 200 && response.status < 300,
                status: response.status,
                json: async () => response.data,
                text: async () => JSON.stringify(response.data), // Add text method
            };
        } catch (error) {
            const message = `HTTP Request Error: ${error}. Waiting for ${general_api_error_delay_min} minutes before retrying`;
            logToFile(logFile, message);
            console.error(now() + " " + message);
            await delay(general_api_error_delay);
            logToFile(logFile, 'Retrying request');
            console.log(now() + ': Retrying request');
            retries++;
        }
    }
    const failLogMessage = `FAIL: Failed to fetch after ${maxRetries} retries`;
    logToFile(logFile, failLogMessage);
    console.error(failLogMessage);
    throw new Error(failLogMessage);
};

const createProxy = (target, logFile, verbose, delayMs, safety_delay) => {
    let lastCallTime = 0;

    return new Proxy(target, {
        get(target, prop, receiver) {
            const originalMethod = target[prop];
            logToFile(logFile, `Intercepting property: ${prop}`);
            if (verbose) console.log(`Intercepting property: ${prop}`);

            if (typeof originalMethod === 'function') {
                return async function (...args) {
                    try {
                        const currentTime = Date.now();
                        const timeSinceLastCall = currentTime - lastCallTime;
                        if (timeSinceLastCall < delayMs) {
                            await delay(delayMs - timeSinceLastCall + 10);
                        }
                        lastCallTime = Date.now();
                        logToFile(logFile, `Calling method: ${prop}`);
                        if (verbose) console.log(`Calling method: ${prop}`);
                        const result = await originalMethod.apply(this, args);
                        if (verbose) {
                            logToFile(logFile, `Response: ${JSON.stringify(result, null, 2)}`);
                            console.log(`Response: ${JSON.stringify(result, null, 2)}`);
                        }
                        await delay(delayMs);
                        return result;
                    } catch (error) {
                        logToFile(logFile, `Error in method: ${prop} - ${error}`);
                        console.error(`Error in method: ${prop} - ${error}`);
                        logToFile(logFile, 'Error occurred in method - retrying request');
                        console.log('Error occurred in method - retrying request');
                        await delay(safety_delay); // Wait for 10 seconds before retrying
                        return await originalMethod.apply(this, args); // Retry the method
                    }
                };
            } else if (typeof originalMethod === 'object' && originalMethod !== null) {
                // Recursively create proxies for nested objects
                return createProxy(originalMethod, logFile, verbose, delayMs, safety_delay);
            }
            return Reflect.get(target, prop, receiver);
        }
    });
};

function getNotionWithDelay(delayMs, verbose = false, maxRetries = 10) {
    const confdir = require('os').homedir() + "/.config/notion-cli/";
    const CONFIG_FILE = confdir + 'config.json';
    const LOG_FILE = `notion_client_${new Date().toISOString().replace(/:/g, '')}.log`;

    const data = fs.readFileSync(CONFIG_FILE);
    const config = JSON.parse(data);
    const NOTION_TOKEN = config.token;

    const notionClient = new Client({
        auth: NOTION_TOKEN,
        fetch: (url, options) => fetchWithRetries(url, options, LOG_FILE, verbose, maxRetries)
    });

    return createProxy(notionClient, LOG_FILE, verbose, delayMs, general_api_error_delay);
}

// const notion = getNotion();
const notion = getNotionWithDelay(rate_limit_delay);

function getNotion() {
    const confdir = require('os').homedir() + "/.config/notion-cli/"
    const CONFIG_FILE = confdir + 'config.json';

    const data = fs.readFileSync(CONFIG_FILE);
    const config = JSON.parse(data);

    const NOTION_TOKEN = config.token;

    return new Client({
        auth: NOTION_TOKEN
    });
}

async function query(databaseId, options) {
    let filter = null
    if (options.filterfile !== undefined) {
        console.log("X=" + options.filterfile)
        const jsonstring = fs.readFileSync(options.filterfile);
        filter = JSON.parse(jsonstring)
    }
    if (options.filter !== undefined) {
        if (filter) {
            console.log("Adding --filter <filterstring> to --filterfile <filterfile>.")
        }
        const jsonstring = JSON.parse(options.filter)
        filter = { ...filter, ...jsonstring }
    }
    /* if (!jsonstring) {
      console.log("Use either --filter <filterstring> or [filterfile].")
      process.exit(1)
    } */
    let querystring = {
        database_id: databaseId,
    }
    if (filter) {
        querystring = { ...querystring, filter: filter }
    }

    let sorts = null
    //  .option('-s, --sorts <sorts>', 'Provide a json string that describes a sort.')
    //  .option('-t, --sortsfile <sortsfile>', 'Provide a json string that describes a sort.')
    if (sorts) {
        querystring = { ...querystring, sorts: sorts }
    }
    if (options.page_size) {
        if (parseInt(options.page_size) > 100) {
            console.log("page_size>100")
        }
        querystring = { ...querystring, page_size: parseInt(options.page_size) }
    }
    //console.log("TEMPORARY="+JSON.stringify(   options.start_cursor        ,null,2));
    if (options.cursor) {
        querystring = { ...querystring, start_cursor: options.cursor }
    };
    console.log(`Database ID: ${databaseId}`);
    //console.log("TEMPORARY="+JSON.stringify(   querystring         ,null,2));
    const response = await notion.databases.query(querystring);
    notion_object_export(response.results, options.exportdir, options.database);
    // $data->{result}->{has_more}
    // $data->{result}->{next_cursor}
    // $data->{result}->{results}
    if (options.all || options.ALL) {
        const querystring_original = querystring;
        let resp = response;
        let finalResp = [resp];
        let nextCursor = [];
        let hasMore = [];
        let counterArr = [resp.results.length];
        //console.log("YTEMPORARY="+JSON.stringify(    finalResp       ,null,2))
        nextCursor.push(resp.next_cursor);
        hasMore.push(resp.has_more);
        let iteration = 0;
        while ("has_more" in resp
            && "next_cursor" in resp
            && resp.has_more
            && resp.next_cursor
        ) {
            iteration++;
            const msg = `- ${now()}: Database ID: ${databaseId} - iteration ${iteration}, number of pages ${options.page_size ? options.page_size : 100} = ${iteration * parseInt(options.page_size ? options.page_size : 100)} `;
            if (options.verbose) {
                console.log(msg);
            } else {
                process.stdout.write(`\r${msg}`);
            }
            querystring = { ...querystring_original, start_cursor: resp.next_cursor };
            resp = await notion.databases.query(querystring);
            notion_object_export(resp.results, options.exportdir, options.database);
            finalResp.push(resp);
            nextCursor.push(resp.next_cursor);
            hasMore.push(resp.has_more);
            counterArr.push(resp.results.length);
            // await delay(1000); // Ensure delay between requests
        };
        iteration > 0 && console.log();
        //console.log("XTEMPORARY="+JSON.stringify(    finalResp       ,null,2))
        //console.log(finalResp.length);
        if (options.all) {
            // Flatten
            finalResp = finalResp.map(a => { return a.results });
            finalResp = finalResp.flat(1);
        };
        if (options.invert) {
            // Option to switch
            // obj => Object.fromEntries(Object.entries(obj).map(([k, v]) => [v, k]))
        };
        console.log(`- Final number of entries: ${finalResp.length}`);
        return {
            "next_cursor_array": nextCursor,
            "has_more_array": hasMore,
            "results_length_array": counterArr,
            "results": finalResp
        };
    } else {
        // console.log("Simple");
        console.log(`- Final number of entries: ${response.length}`);
        return response;
    };
}

async function databases(id, options) {
    let response;
    if (id.length > 0 && !options.list && !options.retrieve) {
        options.retrieve = true
    }
    if (options.list || id.length == 0) {
        const resp = await notion.databases.list();
        response = resp.results;
    } else {
        // Needs a promise all
        response = [await notion.databases.retrieve({ database_id: id[0] })];
    }
    // if (options.exportdir) {
    // console.log("DB Exporting to " + options.exportdir);
    // console.log(response);
    notion_object_export(response, options.exportdir, options.database);
    // }
    return response;
}

async function block(id, options) {
    let res = [];
    for (const blockId of id) {
        if (options.verbose) {
            console.log("block: " + blockId);
        }
        const response = await notion.blocks.retrieve({ block_id: blockId });
        let properties = response.properties;
        res.push(response);
        // await delay(1000); // Ensure delay between requests
    }
    return res;
}

async function blocks(blockId, options = {}) {
    console.log("blocks: " + blockId);
    let querystring = {
        block_id: blockId,
    }
    if (options.page_size) {
        if (parseInt(options.page_size) > 100) {
            console.log("page_size>100")
        }
        querystring = { ...querystring, page_size: parseInt(options.page_size) }
    }
    if (options.cursor) {
        querystring = { ...querystring, start_cursor: options.cursor }
    };
    //console.log("TEMPORARY="+JSON.stringify(   querystring         ,null,2));
    const response = await notion.blocks.children.list(querystring);
    notion_object_export(response.results, options.exportdir, options.database);
    // $data->{result}->{has_more}
    // $data->{result}->{next_cursor}
    // $data->{result}->{results}
    if (options.all || options.ALL) {
        const querystring_original = querystring;
        let resp = response;
        let finalResp = [resp];
        let nextCursor = [];
        let hasMore = [];
        let counterArr = [resp.results.length];
        //console.log("YTEMPORARY="+JSON.stringify(    finalResp       ,null,2))
        nextCursor.push(resp.next_cursor);
        hasMore.push(resp.has_more);
        while ("has_more" in resp
            && "next_cursor" in resp
            && resp.has_more
            && resp.next_cursor
        ) {
            // console.log("Repeat: ...");
            querystring = { ...querystring_original, start_cursor: resp.next_cursor };
            resp = await notion.blocks.children.list(querystring); // Corrected line
            notion_object_export(resp.results, options.exportdir, options.database);
            finalResp.push(resp);
            nextCursor.push(resp.next_cursor);
            hasMore.push(resp.has_more);
            counterArr.push(resp.results.length);
            // await delay(1000); // Ensure delay between requests
        };
        //console.log("XTEMPORARY="+JSON.stringify(    finalResp       ,null,2))
        //console.log(finalResp.length);    
        if (options.all) {
            // Flatten
            finalResp = finalResp.map(a => { return a.results });
            finalResp = finalResp.flat(1);
        };
        if (options.invert) {
            // Option to switch
            // obj => Object.fromEntries(Object.entries(obj).map(([k, v]) => [v, k]))
        };
        return {
            "next_cursor_array": nextCursor,
            "has_more_array": hasMore,
            "results_length_array": counterArr,
            "results": finalResp
        };
    } else {
        // console.log("Simple");
        return response;
    };
}

function gettoday() {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const dateString = `${year}-${month}-${day}`;
    return dateString
};


function notion_object_export(response, directory = null, database = false) {
    response.forEach(async r => {
        if (directory) {
            const dir = makeDir(directory + "/" + r.object + "/");
            const filename = dir + r.id + ".json";
            fs.writeFile(filename, JSON.stringify(r), (err) => {
                if (err) throw err;
                // console.log(`Data written to file: ${filename}`);
            });
        }
        if (database) {
            // Save to NeDB
            await dbinsert(r, unique=true);
            // await delay(1000); 
        }
    });
};

function makeDir(outputdirectory) {
    if (!fs.existsSync(outputdirectory)) {
        fs.mkdirSync(outputdirectory);
    }
    return outputdirectory;
}

function getRelativeTime(seconds, relative) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (relative) {
        let result = '';
        if (days > 0) result += `${days} day${days > 1 ? 's' : ''}, `;
        if (hours > 0 || days > 0) result += `${hours} hour${hours !== 1 ? 's' : ''}, `;
        result += `${minutes} minute${minutes !== 1 ? 's' : ''}`;
        return result;
    } else {
        const now = new Date();
        const futureTime = new Date(now.getTime() + seconds * 1000);

        let formattedTime = futureTime.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });

        const dayDifference = Math.floor((futureTime - now) / (1000 * 60 * 60 * 24));
        if (dayDifference > 0) {
            formattedTime += ` (+${dayDifference} day${dayDifference > 1 ? 's' : ''})`;
        }

        return formattedTime;
    }
}

module.exports = {
    getNotion,
    query,
    databases,
    block,
    blocks,
    gettoday,
    notion_object_export,
    makeDir,
    getRelativeTime
};