const fs = require('fs');
const path = require('path');
const {
    databases, query, block, blocks, getNotion, gettoday,
    makeDir, getRelativeTime
} = require('./common.js'); // Assuming these functions are in a separate file

const {
    dbinit,
    dbinsert,
    dbfind,
    dbthis
} = require('./db.js');
const { v4: uuidv4 } = require('uuid');


/*

This script will initially backup all of the notion databases. It's possbile to obtain them
from the notion API.

nb1-databases/databases.json

For each database, we obtain the structure:
nb2-database/${id}/structure.json

We then obtain the set of pages, = set database entries (without content):
nb2-database/${id}/entries.json

nb3-pages/${id}/page.json

5. pages/${id}/blocks.json
6. blocks/${id}_block.json

databases/databases.json
   datdatabase_${id}/structure_${id}.json
   datdatabase_${id}/pagesets_${id}.json
   datdatabase_${id}/pages/${pageid}.json
   datdatabase_${id}/pages/${pageid}/content_${pageid}.json
   database_${id}/pageblocks/${id}.json
   */

function saveDocument(options, document, dir, filename) {
    options.outputdirectory && writeJson(path.join(dir, filename), document);
    options.database && dbinsert(document, unique = true);
}

async function makebackup(id, options) {

    if (options.database) {
        // const mainDir = path.dirname(require.main.filename);
        // const dbpath = path.join(mainDir, '../viewer/data', 'data.db');
        let dbpath;
        if (fs.existsSync(options.database) && options.database.endsWith(".json")) {
            const config = JSON.parse(fs.readFileSync(options.database, 'utf8'));
            dbpath = config.dbpath;
            console.log("DBPATH loaded from json: " + dbpath);
            const dbDir = path.dirname(dbpath);
            if (!fs.existsSync(dbDir)) {
                console.log("Creating directory: " + dbDir);
                fs.mkdirSync(dbDir, { recursive: true });
            }
        } else {
            dbpath = options.database;
        }
        if (options.remove) {
            if (fs.existsSync(dbpath)) {
                console.log("Removing: " + dbpath);
                // Delete dbpath
                fs.unlinkSync(dbpath);
            }
        } else {
            console.log("DBPATH: " + dbpath);
        };
        if (!options.remove && !options.create && !fs.existsSync(dbpath)) {
            console.error("Database does not exist and --create not specified.");
            process.exit(1);
        };
        dbinit(dbpath);
    };

    const notion = getNotion();
    console.log("ID: " + id);
    console.log("Options: " + JSON.stringify(options));
    const today = gettoday();
    if (!options.outputdirectory) {
        // throw new Error('An outputdirectory is required.');
        console.log("No outputdirectory specified: json will not be saved.");
    };
    if (!options.outputdirectory && !options.database) {
        console.log("No outputdirectory or database specified: proceeding is futile.");
        process.exit(1);
    };
    const outputdirectory = !options.outputdirectory ? "" : makeDir(options.outputdirectory + "/" + (options.nodate ? "" : today));
    const objectdir = !options.outputdirectory ? "" : makeDir(outputdirectory + "/objects/");
    // The database structures are written to:
    const databasesdir = !options.outputdirectory ? "" : makeDir(outputdirectory + "/databases/");
    // The pages contained in each database are written into this:
    const database_content_dir = !options.outputdirectory ? "" : makeDir(outputdirectory + "/database_content/");
    // const databasedir = makeDir(objectdir + "/database/");
    // const pagedir = makeDir(objectdir + "/page/");
    // const pagesdir = makeDir(outputdirectory + "/pages/");
    const page_content_dir = !options.outputdirectory ? "" : makeDir(outputdirectory + "/page_content/");
    // const blocksdir = makeDir(outputdirectory + "/blocks/");

    // Step 1: Get one or all databases:
    // const database_list = await notion.databases.list();
    const database_list = await databases(id, {
        ...options,
        "all": true,
        exportdir: objectdir
    });
    // options.outputdirectory && writeJson(databasesdir + "index.json", database_list);
    const databaseListDocument = {
        "object": "database_list",
        "native_object": false,
        "id": uuidv4(),
        "last_edited_time": new Date().toISOString(),
        contents: database_list
    };
    saveDocument(options, databaseListDocument, databasesdir, "index.json");
    // let database_files = [];
    let page_ids = [];
    // Step 2: Iterate over the databases:
    for (const database of database_list) {
        // Step 3: Get the database title:
        const fulltitle = database.title.map(titleObject => titleObject.plain_text).join('');
        const filename = `${database.id}_${fulltitle}.json`;
        // Step 4: Write the database to file:
        // This file contains the database object, i.e., the database structure:
        // writeJson(databasesdir + "structure_" + filename, database);
        // Step 5: Query the database to get the page entries:
        options.outputdirectory && fs.writeFileSync(objectdir + "info.txt", `Contains basic objects (such as pages and blocks.
            Contains pages generated from database content. Should also contain pages obtained from crawling, but not implemented yet.");
            Contains blocks generated from pages content.`);
        const res = await query(database.id,
            {
                ...options,
                "exportdir": objectdir,
                "all": true,
                // "verbose": true,
            }); // ALL
        // The entries in that database to a file. These contain the database properties of that page.
        console.log(`- Entries in ${filename}: ${res.results.length}`);
        const pages_in_database_doc = {
            "object": "database_content",
            "native_object": false,
            "id": uuidv4(),
            "database_id": database.id,
            "last_edited_time": new Date().toISOString(),
            contents: res.results
        }
        // const outfile = database_content_dir + "pages_" + filename;
        saveDocument(options, pages_in_database_doc, database_content_dir, `pages_${filename}`);
        // db.insert(document, (err, newDoc) => {
        //     if (err) {
        //         console.error('Error saving to NeDB:', err);
        //     } else {
        //         console.log('Saved to NeDB:', newDoc);
        //     }
        // });
        // To get page content, we now need to iterate overeach page.
        // Let's just save the filename for now, so we can load later:
        // database_files.push(outfile);
        for (const page of pages_in_database_doc.contents) {
            page_ids.push(page.id);
        };
    };

    console.log("Total pages captured: ", page_ids.length);
    // fs.writeFileSync(`pages_${new Date().toISOString()}.txt`, page_ids.join("\n"));
    const pagesInDatabasesDocument = {
        "object": "pages_in_databases",
        "native_object": false,
        "id": uuidv4(),
        "last_edited_time": new Date().toISOString(),
        contents: page_ids
    };
    saveDocument(options, pagesInDatabasesDocument, databasesdir, "pages_in_databases.json");

    if (options.noBlocks) {
        return;
    };
    const totalPages = page_ids.length;
    let lastPercentage = -1;
    const startTime = Date.now();
    for (let i = 0; i < totalPages; i++) {
        const pageid = page_ids[i];
        const content = await blocks(pageid, {
            ...options,
            "all": true,
            "exportdir": objectdir
        });
        const document = {
            "object": "pageblocks",
            "native_object": false,
            "id": uuidv4(),
            "pageb_id": pageid,
            "last_edited_time": new Date().toISOString(),
            contents: content.results
        }
        saveDocument(options, document, page_content_dir, `${pageid}.json`);
        // Show progress every 1%
        const perentageFraction = 100;
        const currentPercentage = Math.floor((i + 1) / totalPages * 100 * perentageFraction);
        if (currentPercentage > lastPercentage) {
            const elapsedTime = (Date.now() - startTime) / 1000; // in seconds
            const pagesPerSecond = (i + 1) / elapsedTime;
            const remainingPages = totalPages - (i + 1);
            const eta = remainingPages / pagesPerSecond;
            const etatimeRemaining = getRelativeTime(eta.toFixed(0), true);
            const etatimeHMactual = getRelativeTime(eta.toFixed(0), false);
            process.stdout.write(`\rProgress @ ${now()}: ${currentPercentage / perentageFraction}% (${i + 1}/${totalPages}). Remaining: ${etatimeRemaining}, ETA: ${etatimeHMactual}`);
            lastPercentage = currentPercentage;
        }
    }
    console.log(); // New line after progress is complete

    // for (const filename of database_files) {
    //     const res = JSON.parse(fs.readFileSync(filename, 'utf8'));
    //     const pages = res.contents;
    //     for (const page of pages) {
    //         // Step 6: Get the page content:
    //         const content = await blocks(page.id, {
    //             ...options,
    //             "all": true,
    //             "exportdir": objectdir
    //         });
    //         const document = {
    //             "object": "pageblocks",
    //             "native_object": false,
    //             "id": page.id,
    //             "last_edited_time": new Date().toISOString(),
    //             contents: content.results
    //         }
    //         writeJson(page_content_dir + page.id + ".json", document);
    //         if (options.database) {
    //             dbinsert(document, unique = true);
    //         };
    //         /* 
    //           notion_object_export(objectdir, content.results);
    //           // We may then need to get blocks as well...
    //         */
    //     }
    // }

    // console.log(database_list.length);
    // return database_list;
};

function writeJson(filename, entry, verbose = false) {
    fs.writeFile(filename, JSON.stringify(entry), (err) => {
        if (err) throw err;
        verbose && console.log(`Data written to file: ${filename}`);
    });
}

module.exports = { makebackup, makeDir, writeJson };