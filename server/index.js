const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const os = require('os');

const db = require('./db');
const whatsapp = require('./whatsapp');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Connect socket.io to whatsapp service
whatsapp.setSocketIO(io);

// Helper to get local network IP address (prioritizes 192.168.x.x, 10.x.x.x, 172.x.x.x)
function getLocalIpAddresses() {
    const interfaces = os.networkInterfaces();
    const validIps = [];
    let bestIp = 'localhost';

    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                // Ignore APIPA link-local 169.254.x.x
                if (iface.address.startsWith('169.254.')) continue;
                
                validIps.push({ name, address: iface.address });
                if (iface.address.startsWith('192.168.') || iface.address.startsWith('10.')) {
                    bestIp = iface.address;
                }
            }
        }
    }

    if (bestIp === 'localhost' && validIps.length > 0) {
        bestIp = validIps[0].address;
    }

    return { bestIp, validIps };
}

function getLocalIpAddress() {
    return getLocalIpAddresses().bestIp;
}

// REST API Endpoints (STRICTLY READ-ONLY)

// 1. WhatsApp status and QR code
app.get('/api/status', (req, res) => {
    res.json(whatsapp.getStatus());
});

// 2. Chat list (Name, Phone Number, 1-line message preview, unread, deleted counts)
app.get('/api/chats', (req, res) => {
    const query = req.query.q || '';
    const chats = db.getChats(query);
    res.json({ success: true, chats });
});

// 3. Single chat info
app.get('/api/chats/:jid', (req, res) => {
    const chat = db.getChatByJid(req.params.jid);
    if (!chat) {
        return res.status(404).json({ success: false, message: 'Chat tidak ditemukan' });
    }
    res.json({ success: true, chat });
});

// 4. Messages for a specific chat
app.get('/api/chats/:jid/messages', (req, res) => {
    const jid = req.params.jid;
    const limit = parseInt(req.query.limit) || 200;
    const messages = db.getMessagesForChat(jid, limit);
    res.json({ success: true, messages });
});

// 5. Unlink / Logout
app.post('/api/logout', async (req, res) => {
    try {
        await whatsapp.logout();
        res.json({ success: true, message: 'Berhasil memutuskan tautan barcode' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 6. Network info (to easily open on Android phone)
app.get('/api/network-info', (req, res) => {
    const ip = getLocalIpAddress();
    const port = PORT;
    res.json({
        ip,
        port,
        url: `http://${ip}:${port}`
    });
});

// WebSocket real-time connection
io.on('connection', (socket) => {
    // Send immediate initial status upon connection
    socket.emit('connection_status', whatsapp.getStatus());

    socket.on('request_status', () => {
        socket.emit('connection_status', whatsapp.getStatus());
    });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0