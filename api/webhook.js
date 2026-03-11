// Luma → 021:Events Student Registry
// Receives a webhook from Luma when a guest registers, adds them to Notion.
//
// Environment variables (set in Vercel dashboard):
//   NOTION_TOKEN         — your Notion integration token
//   NOTION_DATABASE_ID   — the Student Registry database ID

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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true });
  }

  const { NOTION_TOKEN, NOTION_DATABASE_ID } = process.env;

  if (!NOTION_TOKEN || !NOTION_DATABASE_ID) {
    console.error('Missing env vars: NOTION_TOKEN or NOTION_DATABASE_ID');
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  try {
    const raw = await getRawBody(req);
    if (!raw) return res.status(200).json({ ok: true });

    const payload = JSON.parse(raw);

    // Luma payload: { data: { user_name, user_email, event: { name, start_at, ... }, ... } }
    const data  = payload.data || payload;
    const event = data.event || {};

    const name      = data.user_name || data.name || 'Unknown';
    const email     = data.user_email || data.email;
    const eventName = event.name || 'Unknown Event';
    const eventDate = (event.start_at || '').split('T')[0] || null;

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
    const properties = {
      'Name':          { title:     [{ text: { content: name } }] },
      'Email':         { email },
      'Channel':       { rich_text: [{ text: { content: 'Luma' } }] },
      'Workshop Name': { rich_text: [{ text: { content: eventName } }] },
    };

    if (eventDate) {
      properties['Workshop Date'] = { date: { start: eventDate } };
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

    console.log(`Added: ${name} (${email}) — ${eventName}`);
    return res.status(200).json({ message: 'Student added', name, email });

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
