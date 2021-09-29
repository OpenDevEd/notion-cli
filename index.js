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
const { exec } = require("child_process");

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
  .option('--open', 'Open url(s) resulting from the calls via xdg-open')

program
  .command('users [id...]')
  .description('List of users')
  .action(async (id, options) => {
    runner(users, id, options)
  });

program
  .command('databases [id...]')
  .option('-l, --list', 'list all databases (which the integration has access to). Endpoint: [get] https://api.notion.com/v1/databases')
  .option('-r, --retrieve', 'Retrieve database with id. (Requires id.) Endpoint: [get] https://api.notion.com/v1/databases/database_id')
  .description('List databases or retrieve details about databases. Note that only those databases will be retrieved which the integration has access to. If an id is provided without options, \'retrieve\' is assumed. Without any options, \'list\' is assumed. For \'query\' see separate query command. Endpoints: /databases, /databases/database_id')
  .action(async (id, options) => {
    runner(databases, id, options)
  });

program
  .command('update <id...>')
  .option('-p, --properties <string>', 'Json string for the update')
  .description('Update page(s) with given properties. API doc: https://developers.notion.com/reference/patch-page. Examples for <string>: \'{"Some column": {"number": 12}}\' or \'{"Some property": {"date": {"start": "2021-08-11", "end":"2021-08-12"}}}\'. (Unclear how to set the date to undefined.)')
  .action(async (id, options) => {
    runner(update, id, options)
  });


program
  .command('page <id...>')
  .option('--copy [database]', 'Copy the page to a database.')
  .option('--duplicate', 'Duplicate the page within the same database.')
  .option('-n, --name <name>', 'Use the name provided for the copy or duplicate (inserted into id=title field).')
  .option('--data <file>', 'provide a file with json to apply to copy.')
  .option('--json <string>', 'provide a string with json to apply to copy.')
  .option('--date [string]', 'Add a date to various fields (Date, Due, Week, Month, Year). Defaults to today.')
  .option('--hours [number]', 'Defaults to 1.')
  .description('Retrieve or duplicate page. Note that page \'linked\' properties (e.g. related) will only appear in the json if the integration has access to the linked tables. Further, in the API, the number of such related entries appears to be limited to 25.')
  .action(async (id, options) => {
    runner(page, id, options)
  });

program
  .command('create <template...>')
  .option('-b, --database <database>', 'Create in database.')
  .option('-n, --name <name>', 'Use the name provided for the copy or duplicate.')
  .description('Create page(s) in a database from template(s).')
  .action(async (template, options) => {
    runner(create, template, options)
  });

program
  .command('query <database>')
  .option('-f, --filter <filter>', 'Provide a json string that describes a filter (alternative to providing a -f <filter>).')
  .option('-i, --filterfile <filterfile>', 'Provide a file with json string that describes a filter (alternative to providing a -i <filterfile>).')
  .option('-s, --sorts <sorts>', 'Provide a json string that describes a sort.')
  .option('-t, --sortsfile <sortsfile>', 'Provide a json string that describes a sort.')
  .option('-c, --cursor <cursor>', 'Set the start_cursor.')
  .option('-p, --page_size <page_size>', 'Set the page size.')
  .description('Query the database <database> with filter. API ref: https://developers.notion.com/reference/post-database-query Endpoint: [post] https://api.notion.com/v1/databases/database_id/query')
  .action(async (database, options) => {
    runner(query, database, options)
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
  if (fn.name == "page") {
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
    // We might have an option here that exports the template but using keys.
    // Alternatively, have an option under 'create' that can work with the 'exportdata' format.
  }
  if (!globaloptions.quiet) {
    console.log(stroutput)
  }
  if (globaloptions.open) {
    await Promise.all(output.result.map(async (res) => {
      if (res.url) await system(`xdg-open "${res.url}"`);
    }));
  }
}

async function users(id, options) {
  const listUsersResponse = await notion.users.list()
  return listUsersResponse
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


async function update(id, options) {
  let res = []
  await Promise.all(id.map(async (pageId) => {
    if (!options.properties) {
      const response = await notion.pages.retrieve({ page_id: pageId });
      res.push(response);
    } else {
      const command = {
	page_id: id,
	properties: JSON.parse(options.properties)
      };
      // console.log("TEMPORARY="+JSON.stringify(   command         ,null,2))       
      const response = await notion.pages.update(command);
      res.push(response);
    };
  }));
  return res
};

/*
Each page property is computed with a limit of 25 page references. Therefore relation property values feature a maximum of 25 relations, rollup property values are calculated based on a maximum of 25 relations, and rich text property values feature a maximum of 25 page mentions.
*/

async function page(id, options) {
  let res = []
  await Promise.all(id.map(async (pageId) => {
    const response = await notion.pages.retrieve({ page_id: pageId });
    let properties = response.properties
    let databaseid = response.parent.database_id
    let icon = response.icon
    //console.log(JSON.stringify(response, null, 2))
    //process.exit(1)
    if (options.duplicate || options.copy) {
      if (options.copy) {
        databaseid = options.copy
      }
      properties = removeNonEditable(properties)
      // Find the property that has type 'title' (or id 'title')`
      const resp = await createPage(properties, databaseid, options, icon)
      res.push(resp)
    } else {
      res.push(response)
    };
  }));
  return res
}

async function create(template, options) {
  let res = []
  const icon = null
  await Promise.all(template.map(async (te) => {
    const json = fs.readFileSync(te);
    const properties = JSON.parse(json);
    const resp = await createPage(properties, options.database, options, icon)
    res.push(resp)
  }));
  return res
}

async function createPage(properties, databaseid, options, icon) {
  const title = identifyTitle(properties)
  // It should be possible to set properties by id (according to API docs), but not sure how.
  //console.log("TEMPORARY="+JSON.stringify(  properties          ,null,2)) 
  //console.log("TEMPORARY=" + JSON.stringify(properties[title].title[0].text.content, null, 2))
  properties[title] = {
    title: [
      {
        text: {
          content: options.name ? options.name : "COPY OF " + properties[title].title[0].text.content
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
      "Due date": ymd,
      "Due date [scheduled]": ymd,
      "Due Date": ymd,
      Date: ymd
    }
    if (globaloptions.debug)
      console.log("Date_options=" + JSON.stringify(thedate, null, 2))
    if (options.hours) {
      thedate["Hours actual"] = parseFloat(options.hours)
      thedate["Hrs actual [per owner]"] = parseFloat(options.hours)
    }
    Object.keys(thedate).forEach(x => {
      if (properties[x]) {
        if (properties[x].number) properties[x].number = thedate[x]
        if (properties[x].date) properties[x].date.start = thedate[x]
      }
    })
  }
  //console.log("TEMPORARY="+JSON.stringify(   properties         ,null,2))
  //process.exit(1)

  // Not sure if this url="" is a bug. The following fixes this:
  if (properties.URL.url == "") {
    properties.URL.url = null
  };

  let createCommand = {
    parent: {
      database_id: databaseid
    },
    properties: properties
  };
  if (icon) { 
    createCommand  =  { icon, ...createCommand }
  };
  //console.log("TEMPORARY="+JSON.stringify(    createCommand     ,null,2))
  //process.exit(1)
  // Bug: Where multi_select has no optins, it's set to null,
  /* "properties": {
    "Tags": {
      "id": "bXr~",
      "type": "multi_select",
      "multi_select": null
    },
  */
  // instead, it needs to be [] for the request to succeed.
  const response = await notion.pages.create(createCommand);
  return response
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

async function system(command) {
  console.log("Exec: " + command)
  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.log(`error: ${error.message}`);
      return;
    }
    if (stderr) {
      console.log(`stderr: ${stderr}`);
      return;
    }
    console.log(`stdout: ${stdout}`);
  });
}
