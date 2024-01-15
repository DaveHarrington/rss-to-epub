require('dotenv').config();

const Epub = require("epub-gen");
const Parser = require("rss-parser");
const fs = require("fs");
const got = require("got");
const { DateTime } = require("luxon");
const tempy = require("tempy");
const util = require("util");
const { CookieJar } = require("tough-cookie");
const { parse } = require("node-html-parser");
const execSync = require('child_process').execSync
const path = require('path');
const { chromium } = require('playwright');
const jsonfile = require('jsonfile')

const MAX_ITEMS_PER_FEED = 5;

SAVED_GUIDS_FILE = "/var/run/rss-to-epub/saved_guids.json";

const default_format = async function (item) {
  var content = item["content:encoded"] || item["content"];

  return `
    <h1>${item.title}</h1>
    <div color:grey>by ${item.creator}</div><br/>
    ${content}`;
};

const substack_format = async function (item) {
  if (item.title.toLowerCase().includes("open thread")) return;

  const root = parse(item["content:encoded"]);
  const anchors = root.querySelectorAll(".header-anchor-widget");
  anchors.forEach((anchor) => {
    anchor.remove();
  });
  // Substack Images now have a webp version that breaks
  const webpsources = root.querySelectorAll("source");
  // console.log(webpsources);
  webpsources.forEach((webpsource) => {
    webpsource.remove();
  });
  const imageexpands = root.querySelectorAll("div.image-link-expand");
  imageexpands.forEach((imageexpand) => {
    imageexpand.remove();
  });

  return `
    <h1>${item.title}</h1>
    <div color:grey>by ${item.creator}</div><br/>
    ${root.toString()}`;
};

const FORMATS = {
  "Yglesias - Slow Boring": async function (item) {
    if (item.link.includes("-thread-")) return; // Skip comment thread posts
    if (
      !item.content ||
      item.content.includes("Listen to more mind-expanding audio")
    ) {
      return;
    }
    const cookieJar = new CookieJar();
    const setCookie = util.promisify(cookieJar.setCookie.bind(cookieJar));
    await setCookie(
      `connect.sid=${process.env.SLOW_BORING_COOKIE}`,
      "https://www.slowboring.com"
    );
    const res = await got(item.link, { cookieJar });
    const root = parse(res.body, {
      blockTextElements: {
        script: false,
      },
    });

    const anchors = root.querySelectorAll(".header-anchor-widget");
    anchors.forEach((anchor) => {
      anchor.remove();
    });
    // Substack Images now have a webp version that breaks
    const webpsources = root.querySelectorAll("source");
    // console.log(webpsources);
    webpsources.forEach((webpsource) => {
      webpsource.remove();
    });
    const imageexpands = root.querySelectorAll("div.image-link-expand");
    imageexpands.forEach((imageexpand) => {
      imageexpand.remove();
    });

    return `
    <h1>${item.title}</h1>
    <div color:grey>by ${item.creator}</div><br/>
    ${root.querySelector(".markup").toString()}`;
  },
  "Astral Codex Ten": substack_format,
  "Zeynep - Insight": substack_format,
  "Paul Graham - Essays": async function (item) {
    const res = await got(item.link);
    var root = parse(res.body);
    var essay =
      root.querySelector("table").childNodes[0].childNodes[2].childNodes[3]
        .childNodes[0].childNodes[0].childNodes[3];

    return `
    <h1>${item.title}</h1>
    <div color:grey>by Paul Graham</div><br/>
    ${essay.toString()}`;
  },
  "Rachel By The Bay": async function (item) {
    item.creator = "Rachel Kroll";
    return await default_format(item);
  },
  Stratechery: async function (item) {
    var content = item["content:encoded"];
    if (ind > -1) {
      content = content.substring(0, ind);
    }
    var ind = content.indexOf("Subscription Information");
    if (ind > -1) {
      content = content.substring(0, ind);
    }
    item["content:encoded"] = content;
    return await default_format(item);
  },
  "Irrational Exuberance": async function (item) {
    item.creator = "Will Larson";
    return await default_format(item);
  },
    "Matt Rickard": async function (item) {
    item.creator = "Matt Rickard";
    return await default_format(item);
  },
  Quanta: async function (item) {
    const cookieJar = new CookieJar();
    const setCookie = util.promisify(cookieJar.setCookie.bind(cookieJar));
    await setCookie(`acceptedPolicy=true`, "https://www.quantamagazine.org");
    const res = await got(item.link, { cookieJar });
    const root = parse(res.body, {
      blockTextElements: {
        script: false,
      },
    });
    return `
    <h1>${item.title}</h1>
    <div color:grey>by ${item.creator}</div><br/>
    ${root.querySelector(".post__content__section").toString()}`;
  },
};

async function sendFeedsToRemarkable() {
  console.log(`Send feeds to remarkable`);

  var datestr = DateTime.local()
    .setZone("America/Los_Angeles")
    .toFormat('yy-LL-dd');

  var title = `${datestr} ` + "RSS Feeds";

  var feeds = [
    {
      name: "Stratechery",
      url: process.env.STRATECHERY_FEED,
    },
    {
      name: "Rachel By The Bay",
      url: "http://rachelbythebay.com/w/atom.xml",
    },
    {
      name: "Yglesias - Slow Boring",
      url: "https://www.slowboring.com/feed",
    },
    {
      name: "Zeynep - Insight",
      url: "https://zeynep.substack.com/feed",
    },
    {
      name: "Astral Codex Ten",
      url: "https://astralcodexten.substack.com/feed",
    },
    {
      name: "Paul Graham - Essays",
      url: "http://www.aaronsw.com/2002/feeds/pgessays.rss",
    },
    {
      name: "Irrational Exuberance",
      url: "https://lethain.com/feeds.xml",
    },
    { name: "Matt Rickard", url: "https://matt-rickard.com/rss" },
    {
      name: "Scott Galloway",
      url: "https://medium.com/feed/@profgalloway",
    },
    {
      name: "Quanta",
      url: "https://www.quantamagazine.org/feed",
    }
  ];

  var saved_guids = {};
  try {
    saved_guids = jsonfile.readFileSync(SAVED_GUIDS_FILE);
  } catch {
  }

  var parser = new Parser();

  var all_content = [];
  var last_guids = {};
  for (const feed_conf of feeds) {
    var format = FORMATS[feed_conf.name] || default_format;
    var feed = [];
    var saved_guid = saved_guids[feed_conf.name];
    try {
      feed = await parser.parseURL(feed_conf.url);
    } catch (err) {
      console.error("Error parsing feed: " + feed_conf.url);
      console.error(err);
      continue;
    }
    var feed_content = [];
    for (
      var i = 0;
      i < feed.items.slice(0, 2 * MAX_ITEMS_PER_FEED).length;
      i++
    ) {
      var item = feed.items[i];
      if (!item.guid) item.guid = item.link;
      if (item.guid == saved_guid) {
        console.log(`found last guid (${item.guid}) for ` + feed_conf.name);
        break;
      }
      try {
        var formated = await format(item);
      } catch (err) {
        console.error("Could not parse for feed: " + feed_conf.name);
        // console.error(item);
        console.error(err);
        var formatted = `
          ${feed_conf.name}: ${item.title}

          Error formatting
          ${err.toString()}
        `;
      }
      if (formated == null) continue;

      feed_content.push({
        title: `${feed_conf.name}: ${item.title}`,
        data: formated,
      });
    }
    if (feed.items && feed.items[0]) {
      last_guids[feed_conf.name] = feed.items[0].guid;
    } else {
      last_guids[feed_conf.name] = saved_guid;
    }
    all_content = all_content.concat(feed_content.slice(0, MAX_ITEMS_PER_FEED));
  }
  console.log("done getting feed content");

  if (all_content.length == 0) {
    console.log("No new content found");
    return;
  }

  var tmp_epub = tempy.file({ name: `${title}.epub` });

  const option = {
    appendChapterTitles: false,
    title: title,
    tocTitle: "Posts",
    author: "remarkable-syncer",
    content: all_content,
  };

  console.log("Generating EPUB");
  await new Epub(option, tmp_epub).promise;
  console.log("Done: " + tmp_epub);

  console.log("Last GUIDs");
  console.log(last_guids);

  await uploadToRemarkable(tmp_epub)

  jsonfile.writeFileSync(SAVED_GUIDS_FILE, last_guids)

}

async function uploadToRemarkable(epub_path) {
    var browser = await chromium.launch({ headless: false });
    var context = await browser.newContext();
    var page = await context.newPage()
    await page.goto('https://my.remarkable.com/myfiles');
    await page.getByLabel('Email address').fill('ozzy.dave@gmail.com');
    await page.getByLabel('Password').fill(process.env.REMARKABLE_PASSWD);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page
      .getByLabel("Import", { exact: true })
      .setInputFiles(epub_path); 

    await page.getByRole('button').filter({ hasText: 'Updated less than a minute ago' }).click();
    await page.getByLabel('Move').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Feeds' }).click();
    await page.getByRole('dialog').getByLabel('Move').click();;
    await browser.close();
}

sendFeedsToRemarkable();
