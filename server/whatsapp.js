const {
    default: makeWASocket,
    DisconnectReason,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    proto,
    WAMessageStubType,
    Browsers
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const db = require('./db');

const authDir = path.join(__dirname, '..', 'data', 'auth_info_wmk');
if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
}

let sock = null;
let currentQrDataUrl = null;
let connectionState = 'disconnected'; // 'disconnected' | 'connecting' | 'qr_ready' | 'connected'
let connectedUserInfo = null;
let ioInstance = null;

function setSocketIO(io) {
    ioInstance = io;
}

function notifyState(state, extra = {}) {
    connectionState = state;
    if (ioInstance) {
        ioInstance.emit('connection_status', {
            state,
            qr: currentQrDataUrl,
            user: connectedUserInfo,
            ...extra
        });
    }
}

function extractMessageText(msg) {
    if (!msg || !msg.message) return '';
    const m = msg.message;
    if (m.conversation) return m.conversation;
    if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
    if (m.imageMessage?.caption) return `📷 Foto: ${m.imageMessage.caption}`;
    if (m.imageMessage) return '📷 [Foto]';
    if (m.videoMessage?.caption) return `🎥 Video: ${m.videoMessage.caption}`;
    if (m.videoMessage) return '🎥 [Video]';
    if (m.audioMessage) return '🎵 [Pesan Suara / Audio]';
    if (m.documentMessage?.fileName) return `📄 Dokumen: ${m.documentMessage.fileName}`;
    if (m.documentMessage?.caption) return `📄 Dokumen: ${m.documentMessage.caption}`;
    if (m.documentMessage) return '📄 [Dokumen]';
    if (m.stickerMessage) return '🏷️ [Stiker]';
    if (m.contactMessage?.displayName) return `👤 Kontak: ${m.contactMessage.displayName}`;
    if (m.locationMessage) return '📍 [Lokasi]';
    if (m.reactionMessage) return ''; // Skip reactions
    return '[Pesan]';
}

function determineMessageType(msg) {
    if (!msg || !msg.message) return 'unknown';
    const m = msg.message;
    if (m.conversation || m.extendedTextMessage) return 'text';
    if (m.imageMessage) return 'image';
    if (m.videoMessage) return 'video';
    if (m.audioMessage) return 'audio';
    if (m.documentMessage) return 'document';
    if (m.stickerMessage) return 'sticker';
    if (m.contactMessage) return 'contact';
    if (m.locationMessage) return 'location';
    return 'other';
}

async function startWhatsApp() {
    try {
        notifyState('connecting');

        const { state, saveCreds } = await useMultiFileAuthState(authDir);
        const { version } = await fetchLatestBaileysVersion();

        sock = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: true,
            auth: state,
            browser: Browsers.ubuntu('Chrome'), // Shows up as Ubuntu / Chrome in Linked Devices
            syncFullHistory: true, // Syncs previous messages for backup
            generateHighQualityLinkPreview: false
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                try {
                    currentQrDataUrl = await QRCode.toDataURL(qr, {
                        margin: 2,
                        width: 320,
                        color: {
                            dark: '#075e54',
                            light: '#ffffff'
                        }
                    });
                    notifyState('qr_ready');
                } catch (err) {
                    console.error('Failed to generate QR code data URL:', err);
                }
            }

            if (connection === 'close') {
                currentQrDataUrl = null;
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                console.log(`[WMK] Koneksi terputus. Status code: ${statusCode}. Reconnecting: ${shouldReconnect}`);

                if (statusCode === DisconnectReason.loggedOut) {
                    notifyState('disconnected', { reason: 'logged_out' });
                    // Clear auth data on logout
                    try {
                        fs.rmSync(authDir, { recursive: true, force: true });
                    } catch (e) {}
                } else {
                    notifyState('connecting', { reason: 'reconnecting' });
                    setTimeout(() => startWhatsApp(), 3000);
                }
            } else if (connection === 'open') {
                currentQrDataUrl = null;
                const user = sock.user;
                connectedUserInfo = {
                    id: user?.id,
                    name: user?.name || user?.notify || 'Target WhatsApp',
                    phone: db.formatJidToNumber(user?.id)
                };
                console.log('[WMK] Terhubung ke WhatsApp Target:', connectedUserInfo);
                notifyState('connected');
            }
        });

        // Handle incoming / historical messages
        sock.ev.on('messages.upsert', async (m) => {
            const messages = m.messages;
            if (!messages || !Array.isArray(messages)) return;

            for (const msg of messages) {
                try {
                    const key = msg.key;
                    if (!key) continue;

                    const chatJid = key.remoteJid;
                    if (!chatJid || chatJid === 'status@broadcast') continue; // Skip WhatsApp status updates

                    // 1. DETECT REVOKE / PESAN TERHAPUS (Anti-Delete)
                    const protocolMessage = msg.message?.protocolMessage;
                    if (protocolMessage && (protocolMessage.type === 0 || protocolMessage.type === 'REVOKE')) {
                        const targetMessageId = protocolMessage.key?.id;
                        if (targetMessageId) {
                            console.log(`[WMK ANTI-DELETE] Terdeteksi pesan dihapus untuk ID: ${targetMessageId}`);
                            const result = db.markMessageAsDeleted(targetMessageId);
                            if (ioInstance) {
                                ioInstance.emit('message_deleted', {
                                    chatJid,
                                    messageId: targetMessageId,
                                    deletedAt: new Date().toISOString()
                                });
                            }
                        }
                        continue;
                    }

                    // 2. REGULAR MESSAGE
                    const text = extractMessageText(msg);
                    if (!text && !msg.message) continue;

                    const messageId = key.id;
                    const fromMe = key.fromMe ? 1 : 0;
                    const senderJid = key.participant || chatJid;
                    const senderName = msg.pushName || (fromMe ? 'Saya' : '');
                    const messageType = determineMessageType(msg);
                    const timestamp = (msg.messageTimestamp ? Number(msg.messageTimestamp) * 1000 : Date.now());

                    // Save to SQLite
                    db.saveMessage({
                        id: messageId,
                        chatJid,
                        senderJid,
                        senderName,
                        fromMe,
                        text,
                        messageType,
                        timestamp,
                        rawJson: null
                    });

                    // Emit to real-time UI
                    if (ioInstance) {
                        ioInstance.emit('new_message', {
                            id: messageId,
                            chatJid,
                            senderJid,
                            senderName,
                            fromMe,
                            text,
                            messageType,
                            timestamp,
                            isDeleted: 0
                        });
                    }
                } catch (err) {
                    console.error('[WMK] Gagal memproses pesan:', err);
                }
            }
        });

        // Intercept message updates (Another channel for message revokes)
        sock.ev.on('messages.update', async (updates) => {
            for (const update of updates) {
                if (update.update?.messageStubType === WAMessageStubType.REVOKE || 
                    (update.update?.message?.protocolMessage && update.update.message.protocolMessage.type === 0)) {
                    const messageId = update.key?.id;
                    if (messageId) {
                        console.log(`[WMK ANTI-DELETE (Update)] Pesan terhapus ID: ${messageId}`);
                        db.markMessageAsDeleted(messageId);
                        if (ioInstance) {
                            ioInstance.emit('message_deleted', {
                                chatJid: update.key?.remoteJid,
                                messageId,
                                deletedAt: new Date().toISOString()
                            });
                        }
                    }
                }
            }
        });

        // Contact name and profile sync
        sock.ev.on('contacts.upsert', (contacts) => {
            for (const contact of contacts) {
                if (!contact.id) continue;
                const name = contact.notify || contact.verifiedName || contact.name;
                if (name) {
                    db.upsertChat({
                        jid: contact.id,
                        name,
                        phoneNumber: db.formatJidToNumber(contact.id)
                    });
                }
            }
        });

    } catch (error) {
        console.error('[WMK] Error starting WhatsApp client:', error);
        notifyState('disconnected', { error: error.message });
    }
}

async function logout() {
    try {
        if (sock) {
            await sock.logout();
        }
    } catch (e) {}
    try {
        fs.rmSync(authDir, { recursive: true, force: true });
    } catch (e) {}
    connectionState = 'disconnected';
    currentQrDataUrl = null;
    connectedUserInfo = null;
    notifyState('disconnected');
    setTimeout(() => startWhatsApp(), 1000);
}

function getStatus() {
    return {
        state: connectionState,
        qr: currentQrDataUrl,
        user: connectedUserInfo
    };
}

module.exports = {
    startWhatsApp,
    setSocketIO,
    getStatus,
    logout
};
