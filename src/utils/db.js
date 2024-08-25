const Datastore = require('nedb');
const path = require('path');
const fs = require('fs');
let db;

function dbinit(dbPath, exists = false) {
    if (exists) {
        console.log("Checking if database exists: " + dbPath);
        if (!fs.existsSync(dbPath)) {
            console.log("Database does not exist. Exiting...");
            process.exit(1);
        } else {
            console.log("Database exists. Continuing...");
        }
    };
    // const mainDir = path.dirname(require.main.filename);
    db = new Datastore({ filename: dbPath, autoload: true });
}
function dbinsert(document, unique = true) {
    if (!db) {
        console.error('Database not initialized');
        process.exit(1);
    }

    // Function to recursively replace dots in keys
    function replaceDots(obj) {
        const newObj = {};
        for (let key in obj) {
            if (obj.hasOwnProperty(key)) {
                const newKey = key.replace(/\./g, '___');
                if (newKey !== key) {
                    console.log(`Replaced key: "${key}" with "${newKey}"`);
                }
                newObj[newKey] = typeof obj[key] === 'object' && obj[key] !== null
                    ? replaceDots(obj[key])
                    : obj[key];
            }
        }
        return newObj;
    }

    // Replace dots in the document
    const sanitizedDocument = replaceDots(document);

    if (unique) {
        // Check if the document already exists
        db.findOne({ id: sanitizedDocument.id }, (err, doc) => {
            if (doc) {
                console.log('Document already exists:', sanitizedDocument.id);
                return true;
            } else {
                insertDocument(sanitizedDocument);
            }
        });
    } else {
        insertDocument(sanitizedDocument);
    }

    function insertDocument(doc) {
        db.insert(doc, (err, newDoc) => {
            if (err) {
                console.error('Error saving to NeDB:', err);
                return false;
            } else {
                // console.log('Saved to NeDB:', newDoc);
                return true;
            }
        });
    }
}

function dbfind(query, callback, verbose = false) {
    if (!db) {
        console.error('Database not initialized');
        process.exit(1);
    }
    console.log('Querying database with:', query);
    db.find(query, (err, docs) => {
        if (err) {
            console.error('Error querying NeDB:', err);
            callback(err, null);
        } else {
            if (verbose) {
                console.log('Found documents:', docs);
            }
            callback(null, docs);
        }
    });
}

function dbthis() {
    if (!db) {
        console.error('Database not initialized');
        process.exit(1);
    }
    return db;
}

module.exports = {
    dbinit,
    dbinsert,
    dbfind,
    dbthis
};