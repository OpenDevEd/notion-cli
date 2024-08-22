const fs = require('fs');
const { Client } = require("@notionhq/client");

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
    //console.log("TEMPORARY="+JSON.stringify(   querystring         ,null,2));
    const response = await notion.databases.query(querystring);
    if (options.exportdir) {
        notion_object_export(options.exportdir, response.results);
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
                notion_object_export(options.exportdir, response.results);
            }
            finalResp.push(resp);
            nextCursor.push(resp.next_cursor);
            hasMore.push(resp.has_more);
            counterArr.push(resp.results.length);
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
    if (id.length > 0 && !options.list && !options.retrieve) {
        options.retrieve = true
    }
    if (options.list || id.length == 0) {
        const response = await notion.databases.list();
        return response
    } else {
        // Needs a promise all
        const response = await notion.databases.retrieve({ database_id: id[0] });
        return response
    }
}

async function block(id, options) {
    let res = []
    await Promise.all(id.map(async (blockId) => {
        const response = await notion.blocks.retrieve({ block_id: blockId });
        let properties = response.properties
        res.push(response)
    }));
    return res
}

async function blocks(blockId, options) {
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
            resp = await notion.databases.query(querystring);
            finalResp.push(resp);
            nextCursor.push(resp.next_cursor);
            hasMore.push(resp.has_more);
            counterArr.push(resp.results.length);
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


function notion_object_export(directory, response) {
    response.forEach(r => {
        const dir = makeDir(directory + "/" + r.object + "/");
        const filename = dir + r.id + ".json";
        fs.writeFile(filename, JSON.stringify(r), (err) => {
            if (err) throw err;
            // console.log(`Data written to file: ${filename}`);
        });
    });
};


module.exports = {
    getNotion,
    query,
    databases,
    block,
    blocks,
    gettoday,
    notion_object_export
};