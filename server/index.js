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

// 5. Focus Mode Endpoints
app.get('/api/focus', (req, res) => {
    const focusJid = db.getFocusJid();
    let focusChat = null;
    if (focusJid) {
        focusChat = db.getChatByJid(focusJid);
    }
    res.json({
        active: !!focusJid,
        focusJid,
        focusChat
    });
});

app.post('/api/focus/toggle', (req, res) => {
    const { jid } = req.body;
    const current = db.getFocusJid();
    let newFocus = null;
    if (current === jid) {
        db.clearFocusJid();
    } else {
        newFocus = db.setFocusJid(jid);
    }
    const focusChat = newFocus ? db.getChatByJid(newFocus) : null;
    io.emit('focus_mode_changed', {
        active: !!newFocus,
        focusJid: newFocus,
        focusChat
    });
    res.json({ success: true, active: !!newFocus, focusJid: newFocus, focusChat });
});

app.post('/api/focus/clear', (req, res) => {
    db.clearFocusJid();
    io.emit('focus_mode_changed', { active: false, focusJid: null, focusChat: null });
    res.json({ success: true, active: false });
});

// 6. Clear all messages for a specific chat (Fitur Layer 1)
app.post('/api/chats/:jid/clear-messages', (req, res) => {
    const jid = req.params.jid;
    db.clearChatMessages(jid);
    io.emit('chat_messages_cleared', { chatJid: jid });
    res.json({ success: true, message: 'Semua pesan di chat ini berhasil dihapus' });
});

// 6b. Batch delete multiple chats (Fitur Layer 1: Hapus Batch Pesan)
app.post('/api/chats/batch-delete', (req, res) => {
    const { jids } = req.body;
    if (!Array.isArray(jids) || jids.length === 0) {
        return res.status(400).json({ success: false, message: 'Tidak ada chat yang dipilih' });
    }
    const count = db.batchDeleteChats(jids);
    io.emit('batch_chats_deleted', { jids });
    res.json({ success: true, count, message: `${count} chat berhasil dihapus` });
});

// 7. Delete single selected message (Fitur Layer 2)
app.delete('/api/messages/:id', (req, res) => {
    const id = req.params.id;
    const success = db.deleteMessageById(id);
    if (success) {
        io.emit('message_deleted_permanently', { messageId: id });
        res.json({ success: true, message: 'Pesan berhasil dihapus' });
    } else {
        res.status(404).json({ success: false, message: 'Pesan tidak ditemukan' });
    }
});

// 8. Unlink / Logout
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

server.listen(PORT, '0.0.0.0', () => {
    const { bestIp, validIps } = getLocalIpAddresses();
    console.log('========================================================');
    console.log('   WMK - WhatsApp Monitor (Read-Only & Anti-Delete)   ');
    console.log('========================================================');
    console.log(`Server aktif:`);
    console.log(`- Akses Lokal PC        : http://localhost:${PORT}`);
    console.log(`- Akses HP Android/WiFi : http://${bestIp}:${PORT}`);
    if (validIps.length > 1) {
        validIps.forEach(net => {
            if (net.address !== bestIp) {
                console.log(`  (Alternatif IP ${net.name}): http://${net.address}:${PORT}`);
            }
        });
    }
    console.log('--------------------------------------------------------');
    console.log('Memulai engine WhatsApp...');

    whatsapp.startWhatsApp();
});
