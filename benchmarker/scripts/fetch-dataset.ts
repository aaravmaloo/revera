#!/usr/bin/env tsx
/**
 * fetch-dataset.ts
 *
 * Populates benchmarker/datasets/npm.jsonl with 100k+ npm packages.
 *
 * Strategy:
 *   1. Seed from known-trusted.jsonl and known-malicious.jsonl (ground-truth labels)
 *   2. Fetch top packages from npm search API (labeled 'trusted')
 *   3. Bulk-fetch additional package names from npm CouchDB replication API
 *      to reach 100k+ total (labeled 'unknown' — for throughput runs)
 *
 * Run:  npm run fetch-dataset  (from benchmarker/)
 *       or:  npx tsx scripts/fetch-dataset.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATASETS_DIR = path.resolve(__dirname, '../datasets');
const OUT_FILE = path.join(DATASETS_DIR, 'npm.jsonl');

// ─── Config ─────────────────────────────────────────────────────────────────

const TOP_PACKAGES_TARGET = 10_000;   // pages of 250 from npm search
const BULK_PACKAGES_TARGET = 32_000;  // total after adding bulk
const SEARCH_PAGE_SIZE = 250;
const RATE_LIMIT_MS = 120;            // ms between API calls
const FETCH_TIMEOUT_MS = 15_000;

// ─── Types ───────────────────────────────────────────────────────────────────

interface PackageEntry {
  registry: 'npm';
  name: string;
  version?: string;
  label: 'trusted' | 'malicious' | 'typosquat' | 'suspicious' | 'unknown';
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJSON(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json', 'User-Agent': 'revera-benchmarker/1.0' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function loadSeedFile(filePath: string): Promise<PackageEntry[]> {
  if (!fs.existsSync(filePath)) return [];
  const entries: PackageEntry[] = [];
  const rl = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity });
  for await (const line of rl) {
    const t = line.trim();
    if (t) {
      try { entries.push(JSON.parse(t)); } catch { /* skip */ }
    }
  }
  return entries;
}

// ─── npm search API (top packages by popularity) ────────────────────────────

async function fetchTopPackages(target: number): Promise<PackageEntry[]> {
  const results: PackageEntry[] = [];
  const seen = new Set<string>();
  
  // Rotating queries with length >= 2 to avoid ERR_TEXT_LENGTH
  const queries = ['node', 'react', 'plugin', 'eslint', 'cli', 'api', 'utils', 'helper', 'types', 'tool'];
  let queryIndex = 0;
  let from = 0;

  console.log(`  Fetching top ${target.toLocaleString()} packages from npm search API...`);

  while (results.length < target && queryIndex < queries.length) {
    const q = queries[queryIndex];
    const url = `https://registry.npmjs.org/-/v1/search?text=${q}&size=${SEARCH_PAGE_SIZE}&from=${from}&quality=0&maintenance=0&popularity=1`;
    try {
      const data = await fetchJSON(url) as {
        objects: Array<{ package: { name: string; version: string } }>;
        total: number;
      };

      if (!data.objects || data.objects.length === 0) {
        queryIndex++;
        from = 0;
        continue;
      }

      for (const obj of data.objects) {
        const name = obj.package?.name;
        const version = obj.package?.version;
        if (!name || seen.has(name)) continue;
        seen.add(name);
        results.push({ registry: 'npm', name, version, label: 'trusted' });
        if (results.length >= target) break;
      }

      from += SEARCH_PAGE_SIZE;
      if (from >= (data.total ?? Infinity)) {
        queryIndex++;
        from = 0;
      }

      process.stdout.write(`\r    ${results.length.toLocaleString()} / ${target.toLocaleString()}  `);
      await sleep(RATE_LIMIT_MS);
    } catch (err) {
      console.warn(`\n  Warning: npm search failed for query="${q}" at from=${from}: ${(err as Error).message}`);
      await sleep(1000);
      queryIndex++;
      from = 0;
    }
  }

  process.stdout.write('\n');
  return results;
}

// ─── npm CouchDB all_docs (bulk package names) ───────────────────────────────

async function fetchBulkPackages(
  alreadySeen: Set<string>,
  targetTotal: number,
): Promise<PackageEntry[]> {
  const results: PackageEntry[] = [];
  const PAGE = 10_000;
  let startKey = '';

  console.log(`  Fetching bulk package list from npm replication endpoint...`);

  while (alreadySeen.size + results.length < targetTotal) {
    const skParam = startKey ? `&startkey=${encodeURIComponent(JSON.stringify(startKey))}&skip=1` : '';
    const url = `https://replicate.npmjs.com/_all_docs?limit=${PAGE}${skParam}`;

    try {
      const data = await fetchJSON(url) as {
        rows: Array<{ id: string; key: string }>;
      };

      if (!data.rows || data.rows.length === 0) break;

      for (const row of data.rows) {
        const name = row.id;
        // Skip internal CouchDB docs and scoped private packages we can't access
        if (!name || name.startsWith('_') || alreadySeen.has(name) || results.some(r => r.name === name)) {
          continue;
        }
        results.push({ registry: 'npm', name, label: 'unknown' });
      }

      const lastRow = data.rows[data.rows.length - 1];
      if (!lastRow || lastRow.id === startKey) break;
      startKey = lastRow.id;

      const total = alreadySeen.size + results.length;
      process.stdout.write(`\r    ${total.toLocaleString()} / ${targetTotal.toLocaleString()}  `);
      await sleep(RATE_LIMIT_MS);
    } catch (err) {
      console.warn(`\n  Warning: bulk fetch failed: ${(err as Error).message}`);
      await sleep(2000);
      break;
    }
  }

  process.stdout.write('\n');
  return results;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n▶  Revera Dataset Fetcher\n');

  fs.mkdirSync(DATASETS_DIR, { recursive: true });

  // 1. Load seed files (ground-truth labels take priority)
  console.log('  Loading seed files...');
  const trustedSeed = await loadSeedFile(path.join(DATASETS_DIR, 'known-trusted.jsonl'));
  const maliciousSeed = await loadSeedFile(path.join(DATASETS_DIR, 'known-malicious.jsonl'));
  const seedEntries = [...trustedSeed, ...maliciousSeed];

  const priorityNames = new Set<string>(seedEntries.map((e) => e.name));
  console.log(`  Seed: ${trustedSeed.length} trusted, ${maliciousSeed.length} malicious/typosquat`);

  // 2. Fetch top packages from npm search
  const topPackages = await fetchTopPackages(TOP_PACKAGES_TARGET);
  // Remove any that conflict with seed labels
  const filteredTop = topPackages.filter((p) => !priorityNames.has(p.name));

  const seenNames = new Set<string>([
    ...priorityNames,
    ...filteredTop.map((p) => p.name),
  ]);

  const combined: PackageEntry[] = [...seedEntries, ...filteredTop];
  console.log(`  After top-packages fetch: ${combined.length.toLocaleString()} total`);

  // 3. Bulk fetch to reach 100k+
  if (combined.length < BULK_PACKAGES_TARGET) {
    const bulk = await fetchBulkPackages(seenNames, BULK_PACKAGES_TARGET);
    combined.push(...bulk);
    console.log(`  After bulk fetch: ${combined.length.toLocaleString()} total`);
  }

  // 4. Deduplicate (shouldn't be needed but safety net)
  const deduped = new Map<string, PackageEntry>();
  for (const entry of combined) {
    // Seed entries win on duplicate names
    if (!deduped.has(entry.name) || priorityNames.has(entry.name)) {
      deduped.set(entry.name, entry);
    }
  }

  // 5. Write output
  const outStream = fs.createWriteStream(OUT_FILE, 'utf-8');
  let written = 0;
  for (const entry of deduped.values()) {
    outStream.write(JSON.stringify(entry) + '\n');
    written++;
  }
  outStream.end();
  await new Promise<void>((r) => outStream.on('finish', r));

  console.log(`\n✓  Written ${written.toLocaleString()} packages → ${OUT_FILE}`);
  console.log(`   Labels: trusted=${[...deduped.values()].filter(e => e.label==='trusted').length.toLocaleString()}`);
  console.log(`           malicious=${[...deduped.values()].filter(e => e.label==='malicious').length}`);
  console.log(`           typosquat=${[...deduped.values()].filter(e => e.label==='typosquat').length}`);
  console.log(`           unknown=${[...deduped.values()].filter(e => e.label==='unknown').length.toLocaleString()}\n`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
