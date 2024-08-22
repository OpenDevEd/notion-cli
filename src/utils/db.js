const Datastore = require('nedb');
const path = require('path');
const mainDir = path.dirname(require.main.filename);
const db = new Datastore({ filename: path.join(mainDir, 'data', 'messages.db'), autoload: true });
module.exports = db;
