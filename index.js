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

const program = new Command();
program.version('0.0.1');

program
  .option('-d, --debug', 'debug')

program
  .command('users')
  .option('-f, --format [format]', 'specify the format: pdf,txt,html,docx,odt,xlsx,ods,csv,tsv,pptx,odp (separate multiple formats with comma)', 'pdf')
  .description('List of users')
  .action(async (options) => {
    users(options)
  });

async function users(options) {
  const listUsersResponse = await notion.users.list()
   console.log(listUsersResponse)
}

program
  .command('page <source...>')
  .option('-f, --format [format]', 'specify the format: pdf,txt,html,docx,odt,xlsx,ods,csv,tsv,pptx,odp (separate multiple formats with comma)', 'pdf')
  .option('-s, --shortcut', 'Create a shortcut in the original folder of the file')
  .description('List of users')
  .action(async (source, options) => {
    page(source,options);
  });

async function page(source, options) {
  source.forEach(async (pageId) => {
    const response = await notion.pages.retrieve({ page_id: pageId });
    console.log(response);
  })  
}



program.parse(process.argv);
const options = program.opts();
if (options.debug) console.log(options);


