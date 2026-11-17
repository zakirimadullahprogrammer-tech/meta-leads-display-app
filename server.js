const express = require('express');
const http = require('http');
const crypto = require('crypto');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: '*'
    }
});

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const APP_SECRET = process.env.APP_SECRET;
const PAGE_TOKEN = process.env.PAGE_TOKEN;

const PORT = process.env.PORT || 3000;
const GRAPH_API = 'https://graph.facebook.com/v21.0';

const leads = [];

app.set('etag', false);

// Handle CORS requests
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }

    next();
});

// Keep the original request body for signature verification
app.use(express.json({
    verify: (req, res, buffer) => {
        req.rawBody = buffer;
    }
}));

// Clean up test values returned by Meta
function cleanFieldValue(value = '') {
    const text = String(value).trim();

    return text.replace(
        /^<test lead:\s*dummy data for\s*(.+?)>$/i,
        (match, fieldName) => {
            return 'Test ' + fieldName.replace(/_/g, ' ');
        }
    );
}

// Meta webhook verification
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('Meta webhook verification successful');
        return res.status(200).send(challenge);
    }

    return res.sendStatus(403);
});

// Receive lead notifications from Meta
app.post('/webhook', (req, res) => {
    const signature = req.get('x-hub-signature-256');

    const expectedSignature = 'sha256=' + crypto
        .createHmac('sha256', APP_SECRET)
        .update(req.rawBody)
        .digest('hex');

    if (!signature || signature.length !== expectedSignature.length) {
        console.warn('Webhook signature verification failed');
        return res.sendStatus(401);
    }

    const isValid = crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
    );

    if (!isValid) {
        console.warn('Invalid webhook signature');
        return res.sendStatus(401);
    }

    res.sendStatus(200);

    const entries = req.body.entry || [];

    for (const entry of entries) {
        const changes = entry.changes || [];

        for (const change of changes) {
            if (change.field !== 'leadgen') {
                continue;
            }

            const leadId = change.value.leadgen_id;

            handleLead(leadId).catch(error => {
                console.error('Error processing lead:', error.message);
            });
        }
    }
});

// Fetch complete lead details from Meta
async function handleLead(leadId) {
    console.log('Fetching lead details:', leadId);

    const response = await fetch(
        `${GRAPH_API}/${leadId}?access_token=${PAGE_TOKEN}`
    );

    const result = await response.json();

    if (!response.ok || result.error) {
        throw new Error(
            result.error?.message || 'Unable to fetch lead details from Meta'
        );
    }

    const lead = {
        id: result.id,
        createdTime: result.created_time,
        fields: {}
    };

    for (const field of result.field_data || []) {
        lead.fields[field.name] = cleanFieldValue(field.values?.[0] || '');
    }

    // Avoid adding the same lead more than once
    const alreadyExists = leads.some(existingLead => {
        return existingLead.id === lead.id;
    });

    if (alreadyExists) {
        console.log('Lead already exists:', lead.id);
        return;
    }

    leads.unshift(lead);

    // Notify connected clients immediately
    io.emit('new_lead', lead);

    console.log('New lead received:', lead.fields);
}

// Return all received leads
app.get('/leads', (req, res) => {
    res.json(leads);
});

// Clear stored leads
app.post('/reset', (req, res) => {
    leads.length = 0;

    io.emit('reset');

    res.send('Leads cleared successfully');
});

// Privacy policy page
app.get('/privacy', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Privacy Policy</title>
        </head>
        <body style="font-family: sans-serif; max-width: 600px; margin: 40px auto; line-height: 1.6;">
            <h1>Privacy Policy</h1>

            <p>
                This application is a technical proof-of-concept.
                Lead information submitted through Meta Lead Ads,
                including names, email addresses and phone numbers,
                is used only to demonstrate real-time lead delivery.
                This information is not sold or shared with third parties.
            </p>

            <p>
                Lead data is temporarily stored in application memory
                and is automatically cleared when the server restarts.
                For data deletion requests, please contact the developer.
            </p>

            <p>Last updated: November 2026</p>
        </body>
        </html>
    `);
});

// Socket.IO connections
io.on('connection', socket => {
    console.log('Client connected:', socket.id);

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

// Start the server
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});