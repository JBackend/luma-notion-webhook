# Luma → 021:Events Student Registry

When someone registers on Luma, they automatically appear in the Notion Student Registry. No Make, no Zapier.

---

## How it works

```
Guest registers on Luma
        ↓ (instant)
Luma fires webhook → your Vercel URL
        ↓
Check if email already exists in Notion
        ↓
If new → create row in Student Registry
```

---

## Deploy in 4 steps

### 1. Create a Notion integration

1. Go to https://www.notion.so/my-integrations
2. Click **New integration**
3. Name it "021 Webhook", select your workspace
4. Copy the **Internal Integration Token** — this is your `NOTION_TOKEN`
5. Open the Student Registry database in Notion → **...** menu → **Connect to** → select "021 Webhook"

### 2. Deploy to Vercel

```bash
# In this folder:
npm install
npx vercel --prod
```

Or connect this folder to a GitHub repo and import it in vercel.com.

### 3. Set environment variables in Vercel

In your Vercel project → Settings → Environment Variables, add:

| Name | Value |
|------|-------|
| `NOTION_TOKEN` | Your Notion integration token (from step 1) |
| `NOTION_DATABASE_ID` | The Student Registry database ID (from the Notion URL) |

### 4. Connect Luma webhook

1. Luma → Settings → Developer → Webhooks → **Create**
2. **URL:** `https://your-vercel-url.vercel.app/api/webhook`
3. **Events:** select `event_guest.created`
4. Save

---

## Test it

In Luma, use the **Send test event** button on the webhook. Check your Notion Student Registry — a test row should appear within seconds.

---

## Notes

- Deduplication is built in — if the same email registers twice, only one row is created
- The `Channel` field defaults to `Northeastern`. If you use this for Maven or Corporate events too, update line 57 in `api/webhook.js`
- Logs are in your Vercel dashboard → Functions → webhook
