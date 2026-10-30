#!/usr/bin/env node
// Henter galleri + udstillingshuse fra hybelhuse.dk og skriver to JSON-feeds.
// Brug: node src/scrape.js [output-mappe]   (standard: ./public)

import { mkdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { parseHTML } from 'linkedom';
import {
  BASE,
  nextPageUrl,
  parseGalleryListPage,
  parseGalleryDetail,
  parseShowHouseListPage,
  parseShowHouseDetail,
  buildFeeds,
} from './parse.js';

const OUT_DIR = process.argv[2] || 'public';
const CONCURRENCY = Number(process.env.CONCURRENCY || 4);
const DELAY_MS = Number(process.env.DELAY_MS || 150);
const MAX_PAGES = 200;
// Sikkerhedsnet: under disse antal antages det, at sitet har ændret markup
const MIN_GALLERIER = Number(process.env.MIN_GALLERIER || 10);
const MIN_HUSE = Number(process.env.MIN_HUSE || 3);
const UA = 'Mozilla/5.0 (compatible; HybelFeedBot/1.0; +https://nozebra.dk)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchDoc(url, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { document } = parseHTML(await res.text());
      return document;
    } catch (err) {
      if (i === tries) throw new Error(`${url}: ${err.message}`);
      await sleep(1000 * i);
    }
  }
}

async function crawlList(startUrl, parsePage) {
  const items = [];
  const seen = new Set();
  let url = startUrl;
  while (url && !seen.has(url) && seen.size < MAX_PAGES) {
    seen.add(url);
    const doc = await fetchDoc(url);
    items.push(...parsePage(doc));
    url = nextPageUrl(doc, '.card_grid-list', url);
    await sleep(DELAY_MS);
  }
  // Fjern dubletter (fx hvis CMS'et ændres midt i en kørsel)
  return [...new Map(items.map((i) => [i.id, i])).values()];
}

async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, list.length) }, async () => {
      while (next < list.length) {
        const i = next++;
        out[i] = await fn(list[i], i);
        await sleep(DELAY_MS);
      }
    }),
  );
  return out;
}

async function writeJsonAtomic(file, data) {
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  await rename(tmp, file);
}

async function main() {
  const t0 = Date.now();
  const fejl = [];

  console.log('Henter oversigter ...');
  const [galleryList, houseList] = await Promise.all([
    crawlList(`${BASE}/galleri`, parseGalleryListPage),
    crawlList(`${BASE}/udstillingshuse`, parseShowHouseListPage),
  ]);
  console.log(`  ${galleryList.length} gallerier, ${houseList.length} udstillingshuse`);

  const detail = (parse) => async (item) => {
    try {
      return parse(await fetchDoc(item.url), item.url);
    } catch (err) {
      fejl.push(err.message);
      return { id: item.id, fejl: err.message };
    }
  };

  console.log('Henter detaljesider ...');
  const houseDetails = await mapLimit(houseList, CONCURRENCY, detail(parseShowHouseDetail));
  const galleryDetails = await mapLimit(galleryList, CONCURRENCY, detail(parseGalleryDetail));

  // Sikkerhedsnet: skriv ikke tomme/ødelagte feeds over de gode, hvis sitet ændrer markup
  if (galleryList.length < MIN_GALLERIER || houseList.length < MIN_HUSE) {
    throw new Error(
      `For få elementer fundet (galleri=${galleryList.length}, huse=${houseList.length}) - feeds ikke opdateret`,
    );
  }
  if (fejl.length > Math.max(5, (galleryList.length + houseList.length) * 0.1)) {
    throw new Error(`For mange fejl (${fejl.length}) - feeds ikke opdateret:\n${fejl.slice(0, 10).join('\n')}`);
  }

  const feeds = buildFeeds({
    galleryList,
    galleryDetails,
    houseList,
    houseDetails,
    generatedAt: new Date().toISOString(),
  });

  await mkdir(OUT_DIR, { recursive: true });
  await writeJsonAtomic(path.join(OUT_DIR, 'galleri.json'), feeds.galleri);
  await writeJsonAtomic(path.join(OUT_DIR, 'udstillingshuse.json'), feeds.udstillingshuse);

  console.log(`Færdig på ${((Date.now() - t0) / 1000).toFixed(0)} sek. Fejl: ${fejl.length}`);
  if (fejl.length) console.warn(fejl.join('\n'));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
