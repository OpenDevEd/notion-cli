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
const rate_limit_reached_delay = 5 * 60 * 10000;
const socket_hangup_delay = 1 * 60 * 10000;

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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

function getNotionWithDelay(delayMs, verbose = false) {
    const confdir = require('os').homedir() + "/.config/notion-cli/"
    const CONFIG_FILE = confdir + 'config.json';
    // const LOG_FILE = confdir + 'notion_client.log';
    const LOG_FILE = `notion_client_${new Date().toISOString().replace(/:/g, '')}.log`;

    const data = fs.readFileSync(CONFIG_FILE);
    const config = JSON.parse(data);

    const NOTION_TOKEN = config.token;

    let lastCallTime = 0;

    const logToFile = (message) => {
        fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} - ${message}\n`);
    };

    const notionClient = new Client({
        auth: NOTION_TOKEN,
        fetch: async (url, options) => {
            const logMessage = `Making request to URL: ${url} with options: ${JSON.stringify(options)}`;
            logToFile(logMessage);
            if (verbose) {
                console.log(logMessage);
            }
            try {
                const response = await axios({
                    method: options.method,
                    url,
                    headers: options.headers,
                    data: options.body,
                    validateStatus: () => true, // Accept all HTTP status codes
                });

                const statusLogMessage = `HTTP Status: ${response.status}`;
                logToFile(statusLogMessage);
                if (verbose) {
                    console.log(statusLogMessage);
                }
                if (response.status === 429) {
                    const rateLimitLogMessage = 'Rate limit exceeded - waiting for 10 minutes before retrying';
                    logToFile(rateLimitLogMessage);
                    console.log(rateLimitLogMessage);
                    // Retry after a delay
                    await delay(rate_limit_reached_delay); // Wait for 10 minutes before retrying
                    const retryLogMessage = "Retrying...";
                    logToFile(retryLogMessage);
                    console.log(retryLogMessage);
                    return await notionClient.fetch(url, options); // Retry the request
                }

                return {
                    ok: response.status >= 200 && response.status < 300,
                    status: response.status,
                    json: async () => response.data,
                    text: async () => JSON.stringify(response.data), // Add text method
                };
            } catch (error) {
                const errorLogMessage = `HTTP Request Error: ${error}`;
                logToFile(errorLogMessage);
                console.error(errorLogMessage);
                const retryLogMessage = 'Error occurred - retrying request';
                logToFile(retryLogMessage);
                console.log(retryLogMessage);
                await delay(socket_hangup_delay); // Wait for 10 seconds before retrying
                return await notionClient.fetch(url, options); // Retry the request
            }
        }
    });

    const createProxy = (target) => {
        return new Proxy(target, {
            get(target, prop, receiver) {
                const originalMethod = target[prop];
                const interceptLogMessage = `Intercepting property: ${prop}`;
                logToFile(interceptLogMessage);
                if (verbose) {
                    console.log(interceptLogMessage);
                }
                if (typeof originalMethod === 'function') {
                    return async function (...args) {
                        try {
                            const currentTime = Date.now();
                            const timeSinceLastCall = currentTime - lastCallTime;
                            if (timeSinceLastCall < delayMs) {
                                await delay(delayMs - timeSinceLastCall + 10);
                            }
                            lastCallTime = Date.now();
                            const methodCallLogMessage = `Calling method: ${prop}`;
                            logToFile(methodCallLogMessage);
                            if (verbose) {
                                console.log(methodCallLogMessage);
                            }
                            const result = await originalMethod.apply(this, args);
                            if (verbose) {
                                const responseLogMessage = `Response: ${JSON.stringify(result, null, 2)}`;
                                logToFile(responseLogMessage);
                                console.log(responseLogMessage);
                            }
                            await delay(delayMs);
                            return result;
                        } catch (error) {
                            const methodErrorLogMessage = `Error in method: ${prop} - ${error}`;
                            logToFile(methodErrorLogMessage);
                            console.error(methodErrorLogMessage);
                            const retryLogMessage = 'Error occurred in method - retrying request';
                            logToFile(retryLogMessage);
                            console.log(retryLogMessage);
                            await delay(socket_hangup_delay); // Wait for 10 seconds before retrying
                            return await originalMethod.apply(this, args); // Retry the method
                        }
                    };
                } else if (typeof originalMethod === 'object' && originalMethod !== null) {
                    // Recursively create proxies for nested objects
                    return createProxy(originalMethod);
                }
                return Reflect.get(target, prop, receiver);
            }
        });
    };
    return createProxy(notionClient);
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
    //console.log("TEMPORARY="+JSON.stringify(   querystring         ,null,2));
    const response = await notion.databases.query(querystring);
    if (options.exportdir) {
        notion_object_export(options.exportdir, response.results, options.database);
    };
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
            // This doesn't quite work as expected:
            if (options.verbose) console.log(`Fetching iteration ${iteration}, number of pages ${options.page_size ? options.page_size : 100} = ${iteration * parseInt(options.page_size ? options.page_size : 100)} `);
            querystring = { ...querystring_original, start_cursor: resp.next_cursor };
            resp = await notion.databases.query(querystring);
            if (options.exportdir) {
                notion_object_export(options.exportdir, response.results, options.database);
            }
            finalResp.push(resp);
            nextCursor.push(resp.next_cursor);
            hasMore.push(resp.has_more);
            counterArr.push(resp.results.length);
            await delay(1000); // Ensure delay between requests
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
    if (options.exportdir) {
        // console.log("DB Exporting to " + options.exportdir);
        // console.log(response);
        notion_object_export(options.exportdir, response, options.database);
    }
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
    if (options.exportdir) {
        notion_object_export(options.exportdir, response.results, options.database);
    }
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
            if (options.exportdir) {
                notion_object_export(options.exportdir, resp.results, options.database);
            };
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


function notion_object_export(directory, response, database = false) {
    response.forEach(async r => {
        const dir = makeDir(directory + "/" + r.object + "/");
        const filename = dir + r.id + ".json";
        fs.writeFile(filename, JSON.stringify(r), (err) => {
            if (err) throw err;
            // console.log(`Data written to file: ${filename}`);
        });
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


module.exports = {
    getNotion,
    query,
    databases,
    block,
    blocks,
    gettoday,
    notion_object_export,
    makeDir
};