#!/usr/local/bin/node

process.on('uncaughtException', (error) => {
  console.log('uncaughtException');
  console.error(error);
});

const fs = require('fs');
const readline = require('readline');
const { Command } = require('commander');
const { Client } = require("@notionhq/client");

const confdir = require('os').homedir() + "/.config/notion-cli/"
const CONFIG_FILE = confdir + 'config.json';

const data = fs.readFileSync(CONFIG_FILE);
const config = JSON.parse(data);

const NOTION_TOKEN  = config.token ;

const notion = new Client({
  auth: NOTION_TOKEN
});


// const listUsersResponse = await notion.users.list()


const program = new Command();
program.version('0.0.1');

program
  .option('-d, --debug', 'debug')

program
  .command('users')
  .option('-s, --save [file]', 'save output, rather than printing to commandline', 'output.json')
  .description('List of users')
  .action(async (options) => {
    users(options)
  });

async function users(options) {
  const listUsersResponse = await notion.users.list()
   console.log(listUsersResponse)
}


program
  .command('databases [id...]')
  .option('-l, --list', 'list all databases (which the integration has access to)')
  .option('-r, --retrieve', 'Retrieve database with id')
  .option('-q, --query', 'Retrieve database with id')
  .option('-s, --save [file]', 'save output, rather than printing to commandline', 'output.json')
  .description('List of databases')
  .action(async (id, options) => {
    id = cleanUp(id);
    databases(id, options)
  });

async function databases(id, options) {
  if (options.list) {
    const response = await notion.databases.list();
    console.log(response)
  };
  if (options.retrieve) {
    const response = await notion.databases.retrieve({ database_id: id[0] });
    console.log(response);
  }
  if (options.query) {
    const response = await notion.databases.query({
      database_id: id[0]
    });
    console.log(response);
  }
}

program
  .command('page <source...>')
  .option('-s, --save [file]', 'save output, rather than printing to commandline', 'output.json')
  .option('--copy [database]', 'Copy the page to a database.')
  .option('--duplicate', 'Duplicate the page within the same database.')
  .option('-n, --name <name>', 'Use the name provided for the copy or duplicate.')
  .description('Retrieve page')
  .action(async (source, options) => {
    source = cleanUp(source);
    page(source,options);
  });


/*
Each page property is computed with a limit of 25 page references. Therefore relation property values feature a maximum of 25 relations, rollup property values are calculated based on a maximum of 25 relations, and rich text property values feature a maximum of 25 page mentions.
*/

async function page(source, options) {
  source.forEach(async (pageId) => {
    const response = await notion.pages.retrieve({ page_id: pageId });
    //console.log(response);
    let properties = response.properties
    let databaseid = response.parent.database_id
    console.log(JSON.stringify(  response          ,null,2))
    if (options.copy) {
      databaseid = options.copy
    }
    if (options.duplicate || options.copy) {
      // Remove properties that cannot be edited    // There may be some more...
      Object.keys(properties).forEach( (o) => {
	if (properties[o]["type"].match(/^(rollup|formula|((created|last_edited)_(time|by)))$/)) {
	  delete properties[o];
	};
      });
      // Find the property that has type 'title' (or id 'title')`
      let title = "";
      Object.keys(properties).forEach( (o) => {
	if (properties[o]["type"] == "title") {
	  title = o
	};
      });
      // It should be possible to set properties by id (according to API docs), but not sure how.
      properties[title] = {
        title: [
          {
            text: {
	      content: 	options.name ? 	options.name : "COPY OF " + properties.Name.title[0].text.content
            },
          },
        ],
      };
      const response = await notion.pages.create({
	parent: {
	  database_id: databaseid
	},
	properties: properties
      });
    } else {
      console.log(JSON.stringify(  response          ,null,2))
    };
  })  
}


program.parse(process.argv);
const options = program.opts();
if (options.debug) console.log(options);


function cleanUp(value) {
  if (Array.isArray(value)) {
    value = value.map(x => cleanUpOne(x));
  } else {
    value = cleanUpOne(value);
  };
  return value;
}

function cleanUpOne(value) {
  if (value.match("notion") || !value.match("-")) {
    value = value.replace(/\?.*$/i, "").replace(/^.*\//, "");
    value = value.replace(/.*\-/,"");
    value = value.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/,"$1-$2-$3-$4-$5");
  };
  return value;
}
