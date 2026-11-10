# Meta Lead Ads → React Native Real-Time PoC

A proof of concept that delivers Meta (Facebook) Lead Ads submissions to a React Native app **in real time** — a lead submitted through Meta's Lead Ads Testing Tool appears in the app's list within seconds, with no manual action on the device.

## Demo

- **Demo video:** : https://www.loom.com/share/b4a132815b2749a9b44c0f7e8a00dfab

## How it works

```
Meta Lead Ads Testing Tool
        │
        │  1. leadgen webhook (contains only leadgen_id — no personal data)
        ▼
Node.js / Express server  (public HTTPS via ngrok)
        │
        │  2. Verify HMAC-SHA256 signature (x-hub-signature-256, App Secret)
        │  3. Ack 200 immediately, then fetch full lead from Graph API
        │     GET /{leadgen_id}?access_token=PAGE_TOKEN   (leads_retrieval)
        │  4. Store lead, emit over WebSocket
        ▼
React Native app (Expo + socket.io-client)
        │
        │  5. socket.on('new_lead') → setState → card renders instantly
        ▼
Lead appears in the open app — zero user action
```

Two pushes with one pull in between: Meta pushes an ID to the server, the server pulls the details (Meta never sends personal data in the webhook itself), then pushes the complete lead to every connected client over a Socket.IO connection the app opened when it launched. The app never polls.

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Node.js 18+, Express, Socket.IO, node:crypto (HMAC verification) |
| Frontend | React Native (Expo), socket.io-client, expo-linear-gradient, @expo/vector-icons, react-native-safe-area-context |
| Meta | Graph API v21.0, Page webhooks (`leadgen` field), Lead Ads Testing Tool |
| Tunnel | ngrok (public HTTPS endpoint for webhook delivery) |

## Repository structure

```
.
├── server/
│   ├── server.js          # Express + Socket.IO backend
│   ├── package.json
│   └── .env.example       # required environment variables (no secrets committed)
├── leads-app/             # Expo React Native app
│   ├── App.js
│   └── package.json
└── README.md
```

## Setup

### 1. Meta prerequisites

1. A Facebook **Page** you admin, and a Meta **app** (Business type) you admin.
2. Grant the app these permissions (via Graph API Explorer, with the Page ticked in the token dialog):
   `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`, `pages_manage_ads`, `leads_retrieval`
3. Accept the Lead Ads terms as the Page admin: https://www.facebook.com/ads/leadgen/tos
4. The app must be in **Live** mode (webhooks are not reliably delivered in Development mode). This requires a Privacy Policy URL, category and icon under App settings → Basic. The server exposes a `/privacy` page that can be used for this.

### 2. Get a long-lived Page access token

```bash
# exchange a short-lived user token for a long-lived one (~60 days)
curl -G "https://graph.facebook.com/v21.0/oauth/access_token" \
  --data-urlencode "grant_type=fb_exchange_token" \
  --data-urlencode "client_id=APP_ID" \
  --data-urlencode "client_secret=APP_SECRET" \
  --data-urlencode "fb_exchange_token=SHORT_LIVED_USER_TOKEN"

# use the long-lived user token to fetch the Page token (does not expire)
curl -G "https://graph.facebook.com/v21.0/PAGE_ID" \
  --data-urlencode "fields=access_token" \
  --data-urlencode "access_token=LONG_LIVED_USER_TOKEN"
```

### 3. Create the lead form (no ad required)

```bash
curl -X POST "https://graph.facebook.com/v21.0/PAGE_ID/leadgen_forms" \
  -d "name=PoC Test Form" \
  -d 'questions=[{"type":"FULL_NAME"},{"type":"EMAIL"},{"type":"PHONE"}]' \
  -d 'privacy_policy={"url":"https://your-server/privacy"}' \
  -d "follow_up_action_url=https://example.com" \
  -d "access_token=PAGE_TOKEN"
```

### 4. Run the server

```bash
cd server
npm install
cp .env.example .env     # fill in the variables below
node --env-file=.env server.js
```

#### Environment variables

| Variable | Description | Source |
|---|---|---|
| `VERIFY_TOKEN` | A short string you choose yourself. Meta echoes it in the `GET /webhook` handshake; it must match the `verify_token` passed when registering the webhook (step 5). | You make it up |
| `APP_SECRET` | The Meta app's secret, used to verify the HMAC-SHA256 signature (`x-hub-signature-256`) on every incoming webhook. | App dashboard → App settings → Basic |
| `PAGE_TOKEN` | Long-lived Page access token with `leads_retrieval`, used to fetch full lead details from the Graph API. | Step 2 above |
| `PORT` | Optional. HTTP port, defaults to `3000`. | — |

In a second terminal:

```bash
ngrok http 3000
```

### 5. Register the webhook and install the app on the Page

```bash
# register the webhook (app access token = "APP_ID|APP_SECRET")
curl -X POST "https://graph.facebook.com/v21.0/APP_ID/subscriptions" \
  -d "object=page" \
  -d "callback_url=https://YOUR-NGROK-URL/webhook" \
  -d "fields=leadgen" \
  -d "verify_token=YOUR_VERIFY_TOKEN" \
  -d "access_token=APP_ID|APP_SECRET"

# install the app on the Page (the step most integrations miss —
# without it, webhook verification succeeds but no events ever arrive)
curl -X POST "https://graph.facebook.com/v21.0/PAGE_ID/subscribed_apps" \
  -d "subscribed_fields=leadgen" \
  -d "access_token=PAGE_TOKEN"
```

### 6. Run the app

```bash
cd leads-app
npm install
# set API_URL in App.js to your ngrok HTTPS URL (no trailing slash)
npx expo start        # press 'a' for Android, 'w' for web, or scan the QR in Expo Go
```

### 7. Test

Open the [Lead Ads Testing Tool](https://developers.facebook.com/tools/lead-ads-testing), select the Page and form, and click **Create lead**. The lead appears in the open app within seconds.

Custom test data (the Testing Tool only generates dummy values; one test lead per form — delete before re-creating):

```bash
curl -X POST "https://graph.facebook.com/v21.0/FORM_ID/test_leads" \
  -d 'field_data=[{"name":"full_name","values":["Priya Sharma"]},{"name":"email","values":["priya@example.com"]},{"name":"phone_number","values":["+919876543210"]}]' \
  -d "access_token=PAGE_TOKEN"
```

## Server endpoints

| Endpoint | Purpose |
|---|---|
| `GET /webhook` | Meta's one-time verification handshake (echoes `hub.challenge` if the verify token matches) |
| `POST /webhook` | Receives `leadgen` events; verifies the HMAC-SHA256 signature, acks 200 immediately, then fetches full lead data from the Graph API and emits `new_lead` over Socket.IO |
| `GET /leads` | Current lead list (used by the app for its initial load) |
| `POST /reset` | Clears the in-memory list and notifies clients (demo convenience) |
| `GET /privacy` | Privacy policy page (required by Meta for Live mode / lead forms) |

## Security notes

- Every webhook delivery is authenticated: the server recomputes the HMAC-SHA256 of the raw request body with the App Secret and compares it to `x-hub-signature-256` using a timing-safe comparison. Unsigned or mis-signed requests are rejected with 401.
- Secrets live in `.env` (gitignored). `.env.example` documents the required keys.
- The webhook payload contains only IDs; personal lead data is only obtainable via an authorized Graph API call with `leads_retrieval`.

## Assumptions & limitations

- Meta app in Live mode with the developer as both app and Page admin; no App Review is needed to retrieve leads from a Page you own.
- Leads are stored **in memory** — restarting the server clears the list. Production would use a database (Postgres/Mongo) and replay missed leads via the Graph API on startup.
- The app is assumed to be **open in the foreground**, so a WebSocket is sufficient. Delivery to a closed/backgrounded app would require push notifications (FCM/APNs).
- ngrok provides the public HTTPS endpoint; its URL changes on restart, which requires re-registering the webhook (`/subscriptions`) and updating `API_URL`. A deployed host (Render/Railway) would remove this.
- A long-lived Page token is stored in an env var; production would manage token refresh and storage in a secrets manager.
- Meta's Testing Tool generates placeholder dummy values (e.g. `<test lead: dummy data for full_name>`); the server reformats only that exact pattern for display and never alters real lead data.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Webhook verification fails | Server/ngrok not running, URL doesn't end in `/webhook`, or verify token mismatch |
| Verified but no events arrive | Missing `subscribed_apps` call, or app is in Development mode |
| Server logs "Invalid signature" | Wrong `APP_SECRET` in `.env` |
| Graph fetch fails after webhook | Expired or wrong `PAGE_TOKEN`, or missing `leads_retrieval` |
| App pill shows "Offline" | Wrong `API_URL`, or stale ngrok URL; socket uses polling→websocket fallback to traverse ngrok |
| "Test lead already exists" | One test lead per form — delete it (Testing Tool or `DELETE /{test_lead_id}`) first |
