#!/usr/bin/env node
// Bulk import Luma CSV export → Notion Student Registry
// Deduplicates by email (skips if email already exists in Notion)
//
// Usage:
//   NOTION_TOKEN=xxx NOTION_DATABASE_ID=yyy node import-csv.js /path/to/file.csv

import { readFileSync } from 'fs';

const CSV_PATH = process.argv[2];
if (!CSV_PATH) {
  console.error('Usage: node import-csv.js <path-to-csv>');
  process.exit(1);
}

const { NOTION_TOKEN, NOTION_DATABASE_ID } = process.env;
if (!NOTION_TOKEN || !NOTION_DATABASE_ID) {
  console.error('Set NOTION_TOKEN and NOTION_DATABASE_ID env vars');
  process.exit(1);
}

const NOTION_HEADERS = {
  'Authorization': `Bearer ${NOTION_TOKEN}`,
  'Notion-Version': '2022-06-28',
  'Content-Type': 'application/json',
};

// --- Parse CSV ---
function parseCSV(text) {
  const lines = text.trim().split('\n');
  const headers = parseCSVLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseCSVLine(line);
    const row = {};
    headers.forEach((h, i) => row[h.trim()] = (values[i] || '').trim());
    return row;
  });
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === ',' && !inQuotes) { result.push(current); current = ''; }
    else { current += ch; }
  }
  result.push(current);
  return result;
}

// --- Notion helpers ---
async function getAllExistingEmails() {
  const emails = new Set();
  let cursor = undefined;
  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const res = await fetch(
      `https://api.notion.com/v1/databases/${NOTION_DATABASE_ID}/query`,
      { method: 'POST', headers: NOTION_HEADERS, body: JSON.stringify(body) }
    );
    const data = await res.json();
    for (const page of data.results || []) {
      const email = page.properties?.Email?.email;
      if (email) emails.add(email.toLowerCase());
    }
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return emails;
}

async function createNotionRow(row) {
  const properties = {
    'Name':          { title: [{ text: { content: row.name } }] },
    'Email':         { email: row.email },
    'Channel':       { rich_text: [{ text: { content: 'Luma' } }] },
    'Workshop Name': { rich_text: [{ text: { content: 'Agentic AI From Zero to One' } }] },
  };

  if (row.first_seen) {
    const dateStr = row.first_seen.split('T')[0];
    if (dateStr) properties['Workshop Date'] = { date: { start: dateStr } };
  }

  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: NOTION_HEADERS,
    body: JSON.stringify({ parent: { database_id: NOTION_DATABASE_ID }, properties }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Notion API error: ${JSON.stringify(err)}`);
  }
  return res.json();
}

// --- Main ---
async function main() {
  const raw = readFileSync(CSV_PATH, 'utf8');
  const rows = parseCSV(raw);

  // Deduplicate within the CSV itself
  const seen = new Set();
  const unique = [];
  for (const row of rows) {
    const email = (row.email || '').toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    unique.push(row);
  }

  console.log(`CSV: ${rows.length} rows → ${unique.length} unique emails`);

  // Fetch all existing emails from Notion
  console.log('Fetching existing Notion records...');
  const existing = await getAllExistingEmails();
  console.log(`Notion: ${existing.size} existing contacts`);

  const toAdd = unique.filter(r => !existing.has(r.email.toLowerCase()));
  console.log(`New contacts to add: ${toAdd.length} (skipping ${unique.length - toAdd.length} duplicates)`);

  if (toAdd.length === 0) {
    console.log('Nothing to import — all contacts already exist.');
    return;
  }

  let added = 0;
  let failed = 0;
  for (const row of toAdd) {
    try {
      await createNotionRow(row);
      added++;
      console.log(`  ✓ ${row.name} (${row.email})`);
      // Small delay to respect Notion rate limits (3 req/s)
      await new Promise(r => setTimeout(r, 350));
    } catch (err) {
      failed++;
      console.error(`  ✗ ${row.name} (${row.email}): ${err.message}`);
    }
  }

  console.log(`\nDone: ${added} added, ${failed} failed, ${unique.length - toAdd.length} skipped (already in Notion)`);
}

main();
