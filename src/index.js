#!/usr/bin/node --unhandled-rejections=strict
// https://developers.notion.com/reference/

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
  .option('-s, --save', 'save full output')
  .option('-S, --saveto [file]', 'save full output to file; default: output.json', 'output.json')
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
  .option('-d, --data <file>', 'File with json string for the update')
  .option('-c, --cover <cover>', 'Json string with cover spec for the update')
  .option('-i, --icon <icon>', 'Json string with icon spec for the update')
  .option('-e, --emoji <emoji>', 'Provide an emoji for the update')
  .option('--archive', 'Archives the page (archived=true): Note that this also seems to set in_trash=true. https://developers.notion.com/reference/archive-a-page')
  .option('--unarchive', 'Unarchives the page (archived=false)')
  .option('--trash', 'Trashes the page (in_trash=true). It is unclear whether teh in_trash flag can be set separately from archive.')
  .option('--untrash', 'Untrashes the page (in_trash=false)')
  .option('--copycover', 'Copy the cover from --from URL to updated page (overridden by -c)')
  .option('--copyicon', 'Copy the icon from --from URL to updated page (overridden by -i)')
  .option('--copyproperties', 'Copy all properties from --from URL to updated page (overriden by -i; erases all existing properties)')
  .option('-f, --from <from>', 'URL for a page, from which cover and icon is copied')
  .option('-r, --addrelation <name>', 'Name of a relation <name>.')
  .option('-v, --relationvalue <name>', 'Page value to be added to the relation.')
  .description('Update page(s) with given properties. API doc: https://developers.notion.com/reference/patch-page. Examples for <string>: \'{"Some column": {"number": 12}}\' or \'{"Some property": {"date": {"start": "2021-08-11", "end":"2021-08-12"}}}\'. (Unclear how to set the date to undefined.)')
  .action(async (id, options) => {
    runner(update, id, options)
  });


program
  .command('page <id...>')
  .option('--copy [database]', 'Copy the page to a database.')
  .option('--duplicate', 'Duplicate the page within the same database.')
  .option('-n, --name <name>', 'Use the name provided for the copy or duplicate (inserted into id=title field).')
  .option('-p, --prefix <name>', 'Use existing page name but add prefix.')
  .option('--data <file>', 'Provide a file with json to apply to copy.')
  .option('--json <string>', 'Provide a string with json to apply to copy.')
  .option('--relation <string>', 'For duplicate: Provide relation name as <string>.')
  .option('--value <string>', 'For duplicate: The id <string> is added to the relation.')
  .option('--valuesource', 'For duplicate: The source page id is added to that relation.')
  .option('--date [string]', 'Add a date to various fields (Date, Due, Week, Month, Year). Defaults to today.')
  .option('--url <string>', 'Provide url that will be applied to a URL or url field in the page.')
  .option('--hours [number]', 'Defaults to 1.')
  .description('Retrieve or duplicate page. Note that page \'linked\' properties (e.g. related) will only appear in the json if the integration has access to the linked tables. Further, in the API, the number of such related entries appears to be limited to 25.')
  .action(async (id, options) => {
    runner(page, id, options)
  });

program
  .command('block <id...>')
  .action(async (id, options) => {
    runner(block, id, options)
  });

program
  .command('blocks <blockId>')
  .option('-p, --page_size <page_size>', 'Set the page size. Max 100.')
  .option('-c, --cursor <cursor>', 'Set the start_cursor.')
  .option('-a, --all', 'Retrieve all results. The results are returned in an flattened array, similar to the usual call. Call specific data is made available in next_cursor_array, has_more_array and results_length_array are available.')
  .option('-A, --ALL', 'Retrieve all results. Note that the results are returned in an array that contains each response. I.e., response[result][results][0][results]')
  .description('Get child blocks response[result][results].')
  .action(async (database, options) => {
    runner(blocks, database, options)
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
  .option('-p, --page_size <page_size>', 'Set the page size. Max 100.')
  .option('-c, --cursor <cursor>', 'Set the start_cursor.')
  .option('-a, --all', 'Retrieve all results. The results are returned in an flattened array, similar to the usual call. Call specific data is made available in next_cursor_array, has_more_array and results_length_array are available.')
  .option('-A, --ALL', 'Retrieve all results. Note that the results are returned in an array that contains each response. I.e., response[result][results][0][results]')
  .option('-v, --verbose', 'Show a progress indicator.')
  .option('-e, --export <exportdir>', 'Export pages as json to exportdir.')
  .description('Query the database <database> with filter. API ref: https://developers.notion.com/reference/post-database-query Endpoint: [post] https://api.notion.com/v1/databases/database_id/query. Results are returned in the array response[result][results].')
  .action(async (database, options) => {
    runner(query, database, options)
  });

program
  .command('backup [id...]')
  .option('-o, --outputdirectory <outputdirectory>', 'Output')
  .description('Backup the database <database> or all databases. Depending on the size of your database, this could take a long time (hours) to complete. Currently, the database structure and all database entries are backup. Page content is not backed up.')
  .action(async (id, options) => {
    runner(makebackup, id, options)
  });


program.parse(process.argv);
const globaloptions = program.opts();
if (globaloptions.debug) console.log("arguments=" + JSON.stringify({
  globaloptions: globaloptions
}, null, 2))


async function runner(fn, id, options) {
  id = cleanUp(id)
  // console.log("TEMPORARY="+JSON.stringify(     id       ,null,2))
  const result = await fn(id, options)
  const output = {
    ids: id,
    options: options,
    globaloptions: globaloptions,
    result: result
  }
  const stroutput = JSON.stringify(output, null, 2)
  if (globaloptions.save) {
    fs.writeFileSync(globaloptions.saveto, stroutput);
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

function gettoday() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const dateString = `${year}-${month}-${day}`;
  return dateString
};

async function makebackup(id, options) {
  console.log(id);
  console.log(options);
  const today = gettoday();
  if (!options.outputdirectory) {
    throw new Error('An outputdirectory is required.');
  }
  const outputdirectory = makeDir(options.outputdirectory + "/" + today);
  const databasesdir = makeDir(outputdirectory + "/databases/");
  const objectdir = makeDir(outputdirectory + "/object/");
  const databasedir = makeDir(objectdir + "/database/");
  const pagedir = makeDir(objectdir + "/page/");
  const pagesetsdir = makeDir(outputdirectory + "/pagesets/");
  const pagesdir = makeDir(outputdirectory + "/pages/");
  const pageblocksdir = makeDir(outputdirectory + "/pageblocks/");
  // const database_list = await notion.databases.list();
  const database_list = await databases(id, options);
  database_list.results.forEach(
    async entry => {
      const fulltitle = entry.title.map(titleObject => titleObject.plain_text).join('');
      const filename = `${entry.id}_${fulltitle}.json`;
      writeJson(databasesdir + filename, entry);
      const res = await query(entry.id, { "all": true, "verbose": true, "exportdir": objectdir }); // ALL
      writeJson(pagesetsdir + filename, res);
      console.log(`- Entries in ${filename}: ${res.results.length}`);
      // To get page content, we now need to iterate over the results
      /* 
        const content = await blocks(id);
        writeJson(pageblocksdir + id,content);
        notion_object_export(objectdir, content.results);
        // We may then need to get blocks as well...
      */
    });

  function writeJson(filename, entry) {
    fs.writeFile(filename, JSON.stringify(entry), (err) => {
      if (err) throw err;
      console.log(`Data written to file: ${filename}`);
    });
  }

  // console.log(database_list.length);
  // return database_list;
};

function makeDir(outputdirectory) {
  if (!fs.existsSync(outputdirectory)) {
    fs.mkdirSync(outputdirectory);
  }
  return outputdirectory;
}

async function update(id, options) {
  let res = []
  await Promise.all(id.map(async (pageId) => {
    if (
      !options.properties
      && !options.cover
      && !options.icon
      && !options.from
      && !options.emoji
      && !options.archive
      && !options.unarchive
      && !options.trash
      && !options.untrash
      && !options.addrelation
      && !options.data
      ) {
      const response = await notion.pages.retrieve({ page_id: pageId });
      res.push(response);
    } else {
      let command = {
        page_id: pageId
      };
      if (options.trash) {
        console.log("Setting in_trash=true")
        command = {
          ...command,
          in_trash: true,
        }
      } else if (options.untrash) {
        console.log("Setting in_trash=false")
        command = {
          ...command,
          in_trash: false,
        }
      };
      if (options.unarchive) {
        console.log("Setting archive=false")
        command = {
          ...command,
          archived: false,
        }
      } else if (options.archive) {
        console.log("Setting archive=true")
        command = {
          ...command,
          archived: true,
        }
      };
      if (options.from) {
        const pageId = cleanUp(options.from);
        const response = await notion.pages.retrieve({ page_id: pageId });
        // console.log("TEMPORARY="+JSON.stringify(   command        ,null,2))
        if (options.copyicon) {
          command = {
            ...command,
            icon: response.icon,
          }
        }
        if (options.copycover) {
          command = {
            ...command,
            cover: response.cover
          };
        };
      };
      if (options.properties) {
        command = { properties: JSON.parse(options.properties), ...command };
      };
      if (options.data) {
        // console.log("Setting data")
        // load file options.data as json object
        const newprops = JSON.parse(fs.readFileSync(options.data))
        if (command.properties) {
          Object.assign(command.properties, newprops)
        } else {
          command = { properties: newprops, ...command };
        }
        //console.log("TEMPORARY="+JSON.stringify(   command        ,null,2))
      }
      if (options.cover) {
        command = { cover: JSON.parse(options.cover), ...command };
      };
      if (options.icon) {
        command = { icon: JSON.parse(options.icon), ...command };
      };
      if (options.emoji) {
        command = { icon: { "type": "emoji", "emoji": options.emoji }, ...command };
      };
      if (options.addrelation) {
        // options.name
        //console.log(options.namex);
        console.log(options)
        const response = await notion.pages.retrieve({ page_id: pageId });
        const value = cleanUp(options.relationvalue)
        part = response["properties"][options.addrelation];
        if (part.has_more) {
          // quit 
          console.log(part);
          console.log("The relationship has more than 25 properties. Quitting...")
          process.exit(1);
        } else {
          part.relation.push({ "id": value[0] });
          // Delete key "has_mode" from part:
          delete part["has_more"];
          delete part["id"];
        }
        // console.log(part);
        const addr = options["addrelation"];
        addme = {};
        addme[addr] = part;
        command = { properties: addme, ...command };
      }
      console.log("TEMPORARY="+JSON.stringify(   command         ,null,2))       
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
    const icon = response.icon
    const cover = response.cover
    //console.log(JSON.stringify(response, null, 2))
    //process.exit(1)
    if (options.duplicate || options.copy) {
      if (options.copy) {
        databaseid = options.copy
      }
      properties = removeNonEditable(properties)
      // Find the property that has type 'title' (or id 'title')`
      if (options.valuesource) {
        options.originalpageid = id
      }
      const resp = await createPage(properties, databaseid, options, icon, cover)
      res.push(resp)
    } else {
      res.push(response)
    };
  }));
  return res
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

async function createPage(properties, databaseid, options, icon, cover) {
  const title = identifyTitle(properties)
  // It should be possible to set properties by id (according to API docs), but not sure how.
  //console.log("TEMPORARY="+JSON.stringify(  properties          ,null,2)) 
  //console.log("TEMPORARY=" + JSON.stringify(properties[title].title[0].text.content, null, 2))
  prefix = ""
  if (options.prefix) {
    prefix = options.prefix
  }
  properties[title] = {
    title: [
      {
        text: {
          content: options.name ? options.name : prefix + properties[title].title[0].text.content
        },
      },
    ],
  };
  if (options.data || options.json) {
    if (options.json) {
      const newprops = JSON.parse(options.json)
      Object.assign(properties, newprops)
    }
    if (options.data) {
      // load file options.data as json object
      const newprops = JSON.parse(fs.readFileSync(options.data))
      Object.assign(properties, newprops)
    }
  };
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
      "Date [scheduled]": ymd,
      "Date[scheduled]": ymd,
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
  if (options.url) {
    const theurl = {
      URL: options.url,
      url: options.url
    }
    Object.keys(theurl).forEach(x => {
      if (properties[x]) {
        if ("url" in properties[x]) properties[x].url = theurl[x]
      }
    })
  };
  // Not sure if this url="" is a bug. The following fixes this:
  if (!(URL in properties) || !("url" in properties.URL) || properties.URL.url == "") {
    if (!(URL in properties)) {
      // properties.URL = {"url": null};
    } else {
      properties.URL.url = null
    };
  };
  //console.log("TEMPORARY="+JSON.stringify(   properties         ,null,2))
  //process.exit(1)

  if (options.relation) {
    part = properties[options.relation];
    if (part.has_more) {
      // quit 
      console.log(part);
      console.log("The relationship has more than 25 properties. Quitting...")
      process.exit(1);
    } else {
      if (options.valuesource) {
        part.relation.push({ "id": options.originalpageid[0] });
      }
      if (options.value) {
        const value = cleanUp(options.value)
        part.relation.push({ "id": value[0] });
      }
      // Delete key "has_mode" from part:
      delete part["has_more"];
      delete part["id"];
      properties[options.relation] = part
      console.log(properties)
      console.log(part)
    }
  }
  let createCommand = {
    parent: {
      database_id: databaseid
    },
    properties: properties
  };
  if (icon) {
    createCommand = { icon, ...createCommand }
  };
  if (cover) {
    createCommand = { cover, ...createCommand }
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
    if (properties[o]["type"].match(/^(rollup|formula|((created|last_edited)_(time|by))|unique_id)$/)) {
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
