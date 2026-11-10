const express = require('express');
const http = require('http');
const crypto = require('crypto');
const { Server } = require('socket.io');

const { VERIFY_TOKEN, APP_SECRET, PAGE_TOKEN } = process.env;
const GRAPH = 'https://graph.facebook.com/v21.0';
const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const leads = [];

app.set('etag', false);

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));

const clean = (v = '') =>
  String(v)
    .replace(/^<test lead:\s*dummy data for\s*(.+?)>$/i, (_m, field) =>
      'Test ' + field.replace(/_/g, ' '))
    .trim();

app.get('/webhook', (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verified');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

app.post('/webhook', (req, res) => {
  const expected = 'sha256=' +
    crypto.createHmac('sha256', APP_SECRET).update(req.rawBody).digest('hex');
  const received = req.get('x-hub-signature-256') || '';

  const valid = expected.length === received.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received));
  if (!valid) {
    console.warn('Invalid signature, request rejected');
    return res.sendStatus(401);
  }

  res.sendStatus(200);

  for (const entry of req.body.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field === 'leadgen') {
        handleLead(change.value.leadgen_id).catch((e) =>
          console.error('Failed to process lead:', e.message));
      }
    }
  }
});

async function handleLead(leadgenId) {
  console.log('Webhook received, leadgen_id:', leadgenId);

  const r = await fetch(`${GRAPH}/${leadgenId}?access_token=${PAGE_TOKEN}`);
  const data = await r.json();
  if (data.error) throw new Error(data.error.message);

  const lead = {
    id: data.id,
    createdTime: data.created_time,
    fields: Object.fromEntries(
      (data.field_data || []).map((f) => [f.name, clean(f.values[0])])
    ),
  };

  if (leads.some((l) => l.id === lead.id)) return;
  leads.unshift(lead);

  io.emit('new_lead', lead);
  console.log('Lead pushed:', lead.fields);
}

app.get('/leads', (_req, res) => res.json(leads));

app.post('/reset', (_req, res) => {
  leads.length = 0;
  io.emit('reset');
  res.send('cleared');
});

app.get('/privacy', (_req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Privacy Policy</title></head>
  <body style="font-family:sans-serif;max-width:600px;margin:40px auto;line-height:1.6">
  <h1>Privacy Policy</h1>
  <p>This application is a technical proof-of-concept. Lead information submitted
  through Meta Lead Ads (name, email, phone number) is used only to demonstrate
  real-time lead delivery and is not sold or shared with third parties.</p>
  <p>Data is stored temporarily in memory and is deleted when the server restarts.
  To request deletion of your information, contact the developer.</p>
  <p>Last updated: November 2026</p>
  </body></html>`);
});

io.on('connection', (socket) => {
  console.log('App connected:', socket.id);
  socket.on('disconnect', () => console.log('App disconnected:', socket.id));
});

server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));