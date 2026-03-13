// Maven → 021:Events Maven Student Registry
// Receives webhooks from Maven for student lifecycle events, syncs to Notion.
//
// Environment variables (set in Vercel dashboard):
//   NOTION_TOKEN              — your Notion integration token
//   MAVEN_NOTION_DATABASE_ID  — the Maven Student Registry database ID

export const config = {
  api: { bodyParser: false }
};

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Events we ignore (no Notion action needed)
const IGNORE_EVENTS = new Set([
  'waitlist.unsubscribed',
  'payment.initiated',
  'payment.abandoned',
  'user_cohort.maybe',
]);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true });
  }

  const { NOTION_TOKEN, MAVEN_NOTION_DATABASE_ID } = process.env;

  if (!NOTION_TOKEN || !MAVEN_NOTION_DATABASE_ID) {
    console.error('Missing env vars: NOTION_TOKEN or MAVEN_NOTION_DATABASE_ID');
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  const NOTION_DATABASE_ID = MAVEN_NOTION_DATABASE_ID;

  try {
    const raw = await getRawBody(req);
    if (!raw) return res.status(200).json({ ok: true });

    const payload = JSON.parse(raw);

    // Log and return the full payload so we can see exactly what Maven sends
    console.log('MAVEN FULL PAYLOAD:', JSON.stringify(payload, null, 2));

    // DEBUG MODE: return the full payload in the response
    if (payload._debug || process.env.MAVEN_DEBUG === 'true') {
      return res.status(200).json({ debug: true, payload });
    }

    const event   = payload.event || '';
    const email   = payload.user?.email || '';
    const name    = payload.user?.preferred_name || payload.user?.name || '';
    const course  = payload.course || '';
    const cohort  = payload.cohort || '';
    const amount  = payload.payment?.amount_total || '';

    console.log(`Maven webhook: ${event} — ${email || name}`);

    // Skip events we don't act on
    if (IGNORE_EVENTS.has(event)) {
      return res.status(200).json({ message: 'Event ignored', event });
    }

    if (!email) {
      console.error('No email in payload');
      return res.status(200).json({ error: 'No email found' });
    }

    // Check if student already exists
    const searchRes = await fetch(
      `https://api.notion.com/v1/databases/${NOTION_DATABASE_ID}/query`,
      {
        method: 'POST',
        headers: notionHeaders(NOTION_TOKEN),
        body: JSON.stringify({
          filter: { property: 'Email', email: { equals: email } }
        })
      }
    );
    const searchData = await searchRes.json();

    if (searchData.results?.length > 0) {
      return res.status(200).json({ message: 'Already in registry', email });
    }

    // Create new row
    const workshopName = [course, cohort].filter(Boolean).join(' — ') || 'Maven Workshop';
    const today = new Date().toISOString().split('T')[0];

    const properties = {
      'Name':          { title:     [{ text: { content: name || email.split('@')[0] } }] },
      'Email':         { email },
      'Channel':       { rich_text: [{ text: { content: 'Maven' } }] },
      'Workshop Name': { rich_text: [{ text: { content: workshopName } }] },
      'First Seen':    { date: { start: today } },
    };

    if (amount) {
      properties['Revenue'] = { number: parseFloat(amount) || 0 };
    }

    const createRes = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: notionHeaders(NOTION_TOKEN),
      body: JSON.stringify({
        parent: { database_id: NOTION_DATABASE_ID },
        properties
      })
    });

    if (!createRes.ok) {
      const err = await createRes.json();
      console.error('Notion create failed:', JSON.stringify(err));
      return res.status(200).json({ error: 'Notion create failed', details: err });
    }

    console.log(`Added: ${name} (${email}) — ${event}`);
    return res.status(200).json({ message: 'Student added', email, event });

  } catch (err) {
    console.error('Error:', err.message);
    return res.status(200).json({ error: err.message });
  }
}

function notionHeaders(token) {
  return {
    'Authorization':  `Bearer ${token}`,
    'Notion-Version': '2022-06-28',
    'Content-Type':   'application/json',
  };
}
