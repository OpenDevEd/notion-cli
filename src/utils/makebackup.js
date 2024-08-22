const fs = require('fs');
const { databases, query, block, blocks, getNotion, gettoday } = require('./common.js'); // Assuming these functions are in a separate file

async function makebackup(id, options) {
    const notion = getNotion();
    console.log(id);
    console.log(options);
    const today = gettoday();
    if (!options.outputdirectory) {
        throw new Error('An outputdirectory is required.');
    }
    const outputdirectory = makeDir(options.outputdirectory + "/" + today);
    // The database structures are written to:
    const databasesdir = makeDir(outputdirectory + "/databases/");
    const objectdir = makeDir(outputdirectory + "/object/");
    // The pages contained in each database are written into this:
    const pagesetsdir = makeDir(outputdirectory + "/pagesets/");
    const databasedir = makeDir(objectdir + "/database/");
    const pagedir = makeDir(objectdir + "/page/");
    const pagesdir = makeDir(outputdirectory + "/pages/");
    const pageblocksdir = makeDir(outputdirectory + "/pageblocks/");
    /*
    databases/databases.json
    datdatabase_${id}/structure_${id}.json
    datdatabase_${id}/pagesets_${id}.json
    datdatabase_${id}/pages/${pageid}.json
    datdatabase_${id}/pages/${pageid}/content_${pageid}.json
    database_${id}/pageblocks/${id}.json
1. databases/databases.json
2. database/${id}/structure.json
3. database/${id}/pageset.json
4. pages/${id}/page.json
5. pages/${id}/blocks.json
6. blocks/${id}_block.json
    */
    // Step 1: Get one or all databases:
    // const database_list = await notion.databases.list();
    const database_list = await databases(id, options);
    // Step 2: Iterate over the databases:
    database_list.results.forEach(
        async entry => {
            // Step 3: Get the database title:
            const fulltitle = entry.title.map(titleObject => titleObject.plain_text).join('');
            const filename = `${entry.id}_${fulltitle}.json`;
            // Step 4: Write the database to file:
            // This file contains the database object, i.e., the database structure:
            writeJson(databasesdir + filename, entry);
            // Step 5: Query the database to get the page entries:
            const res = await query(entry.id, { "all": true, "verbose": true, "exportdir": objectdir }); // ALL
            // The entries in that database to a file. These contain the database properties of that page.
            writeJson(pagesetsdir + filename, res);
            console.log(`- Entries in ${filename}: ${res.results.length}`);
            // To get page content, we now need to iterate overeach page.
            res.results.forEach(async page => {
                // Step 6: Get the page content:
                const content = await blocks(page.id);
                writeJson(pageblocksdir + page.id, content);
                /* 
                  notion_object_export(objectdir, content.results);
                  // We may then need to get blocks as well...
                */
            });
        });

    // console.log(database_list.length);
    // return database_list;
};

function writeJson(filename, entry) {
    fs.writeFile(filename, JSON.stringify(entry), (err) => {
        if (err) throw err;
        console.log(`Data written to file: ${filename}`);
    });
}

function makeDir(outputdirectory) {
    if (!fs.existsSync(outputdirectory)) {
        fs.mkdirSync(outputdirectory);
    }
    return outputdirectory;
}

module.exports = { makebackup, makeDir, writeJson };