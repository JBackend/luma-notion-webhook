// Bulk import Luma CSV members into Notion Student Registry
// Usage: node scripts/import-csv.js

import { readFileSync } from 'fs';

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATABASE_ID = process.env.NOTION_DATABASE_ID;
const CSV_PATH = process.argv[2];

if (!NOTION_TOKEN || !DATABASE_ID || !CSV_PATH) {
  console.error('Usage: NOTION_TOKEN=xxx NOTION_DATABASE_ID=xxx node scripts/import-csv.js <csv-path>');
  process.exit(1);
}

const headers = {
  'Authorization': `Bearer ${NOTION_TOKEN}`,
  'Notion-Version': '2022-06-28',
  'Content-Type': 'application/json',
};

// ── Step 1: Add missing properties to the database ──────────────────────────
async function addProperties() {
  console.log('Adding new properties to database...');
  const res = await fetch(`https://api.notion.com/v1/databases/${DATABASE_ID}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      properties: {
        'First Seen':        { date: {} },
        'Revenue':           { number: { format: 'dollar' } },
        'Events Approved':   { number: { format: 'number' } },
        'Events Checked In': { number: { format: 'number' } },
        'Membership Name':   { rich_text: {} },
        'Membership Status': { rich_text: {} },
        'Tags':              { rich_text: {} },
      }
    })
  });
  if (!res.ok) {
    const err = await res.json();
    console.error('Failed to add properties:', JSON.stringify(err, null, 2));
    process.exit(1);
  }
  console.log('Properties added.');
}

// ── Step 2: Get all existing emails to skip duplicates ──────────────────────
async function getExistingEmails() {
  const emails = new Set();
  let cursor = undefined;
  do {
    const body = cursor ? { start_cursor: cursor } : {};
    const res = await fetch(`https://api.notion.com/v1/databases/${DATABASE_ID}/query`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const data = await res.json();
    for (const page of data.results) {
      const email = page.properties.Email?.email;
      if (email) emails.add(email.toLowerCase());
    }
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return emails;
}

// ── Step 3: Parse CSV ───────────────────────────────────────────────────────
function parseCSV(path) {
  const raw = readFileSync(path, 'utf8');
  const lines = raw.split('\n').filter(l => l.trim());
  const headerLine = lines[0];

  // Handle quoted fields with commas
  function parseLine(line) {
    const fields = [];
    let current = '';
    let inQuotes = false;
    for (const char of line) {
      if (char === '"') { inQuotes = !inQuotes; continue; }
      if (char === ',' && !inQuotes) { fields.push(current.trim()); current = ''; continue; }
      current += char;
    }
    fields.push(current.trim());
    return fields;
  }

  const cols = parseLine(headerLine);
  return lines.slice(1).map(line => {
    const vals = parseLine(line);
    const obj = {};
    cols.forEach((col, i) => { obj[col] = vals[i] || ''; });
    return obj;
  });
}

// ── Step 4: Create a Notion page from a CSV row ─────────────────────────────
async function createPage(row) {
  const name = row.name || row.first_name || 'Unknown';
  const email = row.email;
  const firstSeen = row.first_seen ? row.first_seen.split('T')[0] : null;
  const revenue = row.revenue ? parseFloat(row.revenue.replace(/[^0-9.]/g, '')) : 0;
  const eventsApproved = parseInt(row.event_approved_count) || 0;
  const eventsCheckedIn = parseInt(row.event_checked_in_count) || 0;

  const properties = {
    'Name':              { title: [{ text: { content: name } }] },
    'Email':             { email },
    'Channel':           { rich_text: [{ text: { content: 'Luma' } }] },
    'Status':            { status: { name: 'Registered' } },
    'Revenue':           { number: revenue },
    'Events Approved':   { number: eventsApproved },
    'Events Checked In': { number: eventsCheckedIn },
  };

  if (firstSeen) {
    properties['First Seen'] = { date: { start: firstSeen } };
  }
  if (row.tags) {
    properties['Tags'] = { rich_text: [{ text: { content: row.tags } }] };
  }
  if (row.membership_name) {
    properties['Membership Name'] = { rich_text: [{ text: { content: row.membership_name } }] };
  }
  if (row.membership_status) {
    properties['Membership Status'] = { rich_text: [{ text: { content: row.membership_status } }] };
  }

  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      parent: { database_id: DATABASE_ID },
      properties
    })
  });

  if (!res.ok) {
    const err = await res.json();
    console.error(`  FAILED: ${name} (${email}) —`, err.message);
    return false;
  }
  return true;
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  await addProperties();

  console.log('\nFetching existing emails...');
  const existing = await getExistingEmails();
  console.log(`Found ${existing.size} existing entries.\n`);

  const rows = parseCSV(CSV_PATH);
  console.log(`CSV has ${rows.length} rows.\n`);

  let added = 0, skipped = 0, failed = 0;

  for (const row of rows) {
    if (!row.email) {
      console.log(`  SKIP (no email): ${row.name}`);
      skipped++;
      continue;
    }

    if (existing.has(row.email.toLowerCase())) {
      console.log(`  SKIP (exists): ${row.email}`);
      skipped++;
      continue;
    }

    const ok = await createPage(row);
    if (ok) {
      console.log(`  ADDED: ${row.name} (${row.email})`);
      added++;
      existing.add(row.email.toLowerCase());
    } else {
      failed++;
    }

    // Rate limit: Notion API allows ~3 requests/sec
    await new Promise(r => setTimeout(r, 350));
  }

  console.log(`\nDone! Added: ${added}, Skipped: ${skipped}, Failed: ${failed}`);
}

main().catch(console.error);
