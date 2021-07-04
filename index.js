#!/usr/local/bin/node

process.on('uncaughtException', (error) => {
  console.log('uncaughtException');
  console.error(error);
});

const fs = require('fs');
const readline = require('readline');
const { Command } = require('commander');
const { Client } = require("@notionhq/client");
var _ = require('lodash');
var { DateTime } = require('luxon');
var Sugar = require('sugar');

const confdir = require('os').homedir() + "/.config/notion-cli/"
const CONFIG_FILE = confdir + 'config.json';

const data = fs.readFileSync(CONFIG_FILE);
const config = JSON.parse(data);

const NOTION_TOKEN = config.token;

const notion = new Client({
  auth: NOTION_TOKEN
});

const program = new Command();
program.version('0.0.1');

program
  .option('-d, --debug', 'debug')
  .option('--quiet', 'do not print output to command line')
  .option('-s, --save [file]', 'save full output', 'output.json')
  .option('-t, --template [file]', 'save properties of first result from output, suitable for template in using in create', 'template.json')
  .option('--exportdata <file>', 'save properties of first result from output, suitable for using with --data in "page --duplicate"')

program
  .command('users [id...]')
  .description('List of users')
  .action(async (id, options) => {
    runner(users, id, options)
  });

program
  .command('databases [id...]')
  .option('-l, --list', 'list all databases (which the integration has access to)')
  .option('-r, --retrieve', 'Retrieve database with id')
  .option('-q, --query', 'Retrieve database with id')
  .description('List databases or retrieve details about databases. Note that only those databases will be retrieved which the integration has access to.')
  .action(async (id, options) => {
    runner(databases, id, options)
  });

program
  .command('page <id...>')
  .option('--copy [database]', 'Copy the page to a database.')
  .option('--duplicate', 'Duplicate the page within the same database.')
  .option('-n, --name <name>', 'Use the name provided for the copy or duplicate (inserted into id=title field).')
  .option('--data <file>', 'provide a file with json to apply to copy.')
  .option('--json <string>', 'provide a string with json to apply to copy.')
  .option('--date [string]', 'Add a date to various fields (Date, Due, Week, Month, Year). Defaults to today.')
  .description('Retrieve or duplicate page. Note that page \'linked\' properties (e.g. related) will only appear in the json if the integration has access to the linked tables. Further, in the API, the number of such related entries appears to be limited to 25.')
  .action(async (id, options) => {
    runner(page, id, options)
  });

program
  .command('create <database> <template>')
  .option('-n, --name <name>', 'Use the name provided for the copy or duplicate.')
  .description('Create page in a database from a template.')
  .action(async (id, options) => {
    runner(page, id, options)
  });

program.parse(process.argv);
const globaloptions = program.opts();
if (globaloptions.debug) console.log("arguments=" + JSON.stringify({
  globaloptions: globaloptions
}, null, 2))

async function runner(fn, id, options) {
  id = cleanUp(id)
  const result = await fn(id, options)
  const output = {
    ids: id,
    options: options,
    globaloptions: globaloptions,
    result: result
  }
  const stroutput = JSON.stringify(output, null, 2)
  if (globaloptions.save) {
    fs.writeFileSync(globaloptions.save, stroutput);
  }
  const template = removeNonEditable(output.result[0].properties)
  if (globaloptions.template) {
    fs.writeFileSync(
      globaloptions.template,
      JSON.stringify(
        template,
        null, 2)
    )
  }
  if (globaloptions.exportdata) {
    const arr = Object.keys(template).map(key => ({ __key: key, ...template[key] }));
    fs.writeFileSync(
      globaloptions.exportdata,
      JSON.stringify(arr, null, 2)
    )
  }
  if (!globaloptions.quiet) {
    console.log(stroutput)
  }
}

async function users(id, options) {
  const listUsersResponse = await notion.users.list()
  return listUsersResponse
}

async function databases(id, options) {
  if (options.list || !id) {
    const response = await notion.databases.list();
    return response
  } else {
    if (options.retrieve) {
      const response = await notion.databases.retrieve({ database_id: id[0] });
      return response
    } else if (options.query) {
      const response = await notion.databases.query({
        database_id: id[0]
      });
      return response
    }
  }
}

/*
Each page property is computed with a limit of 25 page references. Therefore relation property values feature a maximum of 25 relations, rollup property values are calculated based on a maximum of 25 relations, and rich text property values feature a maximum of 25 page mentions.
*/

async function page(id, options) {
  let res = []
  await Promise.all(id.map(async (pageId) => {
    const response = await notion.pages.retrieve({ page_id: pageId });
    let properties = response.properties
    let databaseid = response.parent.database_id
    // console.log(JSON.stringify(response, null, 2))
    if (options.duplicate || options.copy) {
      if (options.copy) {
        databaseid = options.copy
      }
      properties = removeNonEditable(properties)
      // Find the property that has type 'title' (or id 'title')`
      const resp = await createPage(properties, databaseid, options)
      res.push(resp)
    } else {
      res.push(response)
    };
  }));
  return res
}

async function createPage(properties, databaseid, options) {
  const title = identifyTitle(properties)
  // It should be possible to set properties by id (according to API docs), but not sure how.
  properties[title] = {
    title: [
      {
        text: {
          content: options.name ? options.name : "COPY OF " + properties.Name.title[0].text.content
        },
      },
    ],
  };
  if (options.data || options.json) {
    if (options.json) {
      const newprops = JSON.parse(options.json)
      Object.assign(properties, newprops)
    }
  }
  if (options.date) {
    var d = DateTime.now();
    if (options.date !== true) {
      // console.log("TEMPORARY=" + JSON.stringify(options, null, 2))
      // DateTime only seems to offer is from iso date
      // d = DateTime.fromISO(options.date)
      // Use Sugar instead:
      const now = new Sugar.Date.create(options.date);
      // Convert Sugar date to ISO and then set DateTime.
      const isodate = Sugar.Date.format(now, "ISO8601")
      if (globaloptions.debug) {
        console.log("isodate: " + isodate)
      }
      d = DateTime.fromISO(isodate)
      //console.log("D="+d)
    }
    const ymd = d.toFormat("yyyy-LL-dd")
    const thedate = {
      Year: d.year,
      Month: d.month,
      Week: d.weekNumber,
      Day: ymd,
      Due: ymd,
      "Due Day": ymd,
      Date: ymd
    }
    if (globaloptions.debug)
      console.log("Date_options=" + JSON.stringify(thedate, null, 2))
    Object.keys(thedate).forEach(x => {
      if (properties[x]) {
        if (properties[x].number) properties[x].number = thedate[x]
        if (properties[x].date) properties[x].date.start = thedate[x]
      }
    })
  }
  const response = await notion.pages.create({
    parent: {
      database_id: databaseid
    },
    properties: properties
  });
  return response
}

function identifyTitle(properties) {
  const title = _.findKey(properties, function (o) { return o.type == "title" })
  // console.log("X"+title)
  /*
  let title = ""
  Object.keys(properties).forEach((o) => {
    if (properties[o]["type"] == "title") {
      title = o
    };
  });
  */
  return title
}

function removeNonEditable(properties) {
  // Remove properties that cannot be edited    // There may be some more...
  Object.keys(properties).forEach((o) => {
    if (properties[o]["type"].match(/^(rollup|formula|((created|last_edited)_(time|by)))$/)) {
      delete properties[o];
    };
  });
  return properties
}


function cleanUp(value) {
  if (Array.isArray(value)) {
    value = value.map(x => cleanUpOne(x));
  } else {
    value = [cleanUpOne(value)]
  };
  return value;
}

function cleanUpOne(value) {
  if (value.match("notion") || !value.match("-")) {
    value = value.replace(/\?.*$/i, "").replace(/^.*\//, "");
    value = value.replace(/.*\-/, "");
    value = value.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5");
  };
  return value;
}
