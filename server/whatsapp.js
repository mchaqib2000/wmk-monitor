const {
    default: makeWASocket,
    DisconnectReason,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    proto,
    WAMessageStubType,
    Browsers,
    jidNormalizedUser,
    getContentType,
    normalizeMessageContent
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

// Helper to extract clean message content and skip internal WhatsApp encryption/protocol stanzas
function extractMessageText(msg) {
    if (!msg || !msg.message) return '';
    const m = normalizeMessageContent(msg.message);
    if (!m) return '';
    const type = getContentType(m);
    if (!type) return ''; // Skip internal stanzas like senderKeyDistributionMessage

    if (type === 'conversation') return m.conversation || '';
    if (type === 'extendedTextMessage') return m.extendedTextMessage?.text || '';
    if (type === 'imageMessage') return m.imageMessage?.caption ? `📷 ${m.imageMessage.caption}` : '📷 [Foto]';
    if (type === 'videoMessage') return m.videoMessage?.caption ? `🎥 ${m.videoMessage.caption}` : '🎥 [Video]';
    if (type === 'audioMessage') return '🎵 [Audio]';
    if (type === 'documentMessage') return m.documentMessage?.fileName ? `📄 ${m.documentMessage.fileName}` : (m.documentMessage?.caption ? `📄 ${m.documentMessage.caption}` : '📄 [Dokumen]');
    if (type === 'stickerMessage') return '🏷️ [Stiker]';
    if (type === 'contactMessage') return m.contactMessage?.displayName ? `👤 Kontak: ${m.contactMessage.displayName}` : '👤 [Kontak]';
    if (type === 'locationMessage') return '📍 [Lokasi]';
    if (type === 'reactionMessage') return ''; // Skip reactions
    if (type === 'pollCreationMessage' || type === 'pollCreationMessageV2' || type === 'pollCreationMessageV3') {
        const poll = m[type];
        return `📊 Polling: ${poll?.name || ''}`;
    }

    return '';
}

function determineMessageType(msg) {
    if (!msg || !msg.message) return 'unknown';
    const m = normalizeMessageContent(msg.message);
    if (!m) return 'unknown';
    const type = getContentType(m);
    if (!type) return 'unknown';
    if (type === 'conversation' || type === 'extendedTextMessage') return 'text';
    if (type === 'imageMessage') return 'image';
    if (type === 'videoMessage') return 'video';
    if (type === 'audioMessage') return 'audio';
    if (type === 'documentMessage') return 'document';
    if (type === 'stickerMessage') return 'sticker';
    if (type === 'contactMessage') return 'contact';
    if (type === 'locationMessage') return 'location';
    return type;
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
            generateHighQualityLinkPreview: false,
            markOnlineOnConnect: false // Jangan pernah kirim status online saat terhubung (Ghost/Stealth Mode)
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

                // Set status presence ke 'unavailable' agar target tidak kelihatan online terus di WhatsApp
                try {
                    await sock.sendPresenceUpdate('unavailable');
                    console.log('[WMK] Status presence disetel ke: unavailable (Offline/Tersembunyi)');
                } catch (err) {
                    console.error('[WMK] Gagal menyetel presence:', err);
                }

                notifyState('connected');
            }
        });

        // Handle incoming / historical messages (Baik Pesan Masuk Maupun Pesan Keluar dari Target)
        sock.ev.on('messages.upsert', async (m) => {
            const messages = m.messages;
            if (!messages || !Array.isArray(messages)) return;

            for (const msg of messages) {
                try {
                    const key = msg.key;
                    if (!key) continue;

                    let chatJid = key.remoteJid;
                    if (msg.message?.deviceSentMessage?.destinationJid) {
                        chatJid = msg.message.deviceSentMessage.destinationJid;
                    }
                    if (!chatJid || chatJid === 'status@broadcast') continue; // Skip status broadcasts
                    chatJid = jidNormalizedUser(chatJid);

                    // MODE FOKUS CHECK: Hanya menerima pesan dari nomor terpilih jika mode fokus aktif
                    const focusJid = db.getFocusJid();
                    if (focusJid && chatJid !== focusJid) {
                        continue;
                    }

                    // 1. DETECT REVOKE / PESAN TERHAPUS (Anti-Delete)
                    const protocolMessage = msg.message?.protocolMessage || normalizeMessage(msg)?.protocolMessage;
                    if (protocolMessage && (protocolMessage.type === 0 || protocolMessage.type === 'REVOKE')) {
                        const targetMessageId = protocolMessage.key?.id;
                        if (targetMessageId) {
                            console.log(`[WMK ANTI-DELETE] Terdeteksi pesan dihapus untuk ID: ${targetMessageId}`);
                            db.markMessageAsDeleted(targetMessageId);
                            if (ioInstance) {
                                ioInstance.emit('message_deleted', {
                                    chatJid,
                                    messageId: targetMessageId,
                                    deletedAt: new Date().toISOString()
                                });
                                ioInstance.emit('chats_updated');
                            }
                        }
                        continue;
                    }

                    // 2. REGULAR MESSAGE (Pesan Masuk atau Pesan Keluar dari Target)
                    const text = extractMessageText(msg);
                    if (!text) continue; // Skip internal protocol stanzas (e.g. senderKeyDistributionMessage)

                    const messageId = key.id;
                    const fromMe = Boolean(key.fromMe) ? 1 : 0;
                    const senderJid = key.participant || (fromMe ? (connectedUserInfo?.id || chatJid) : chatJid);
                    const senderName = fromMe ? 'Saya' : (msg.pushName || '');
                    const messageType = determineMessageType(msg);
                    const timestamp = (msg.messageTimestamp ? Number(msg.messageTimestamp) * 1000 : Date.now());

                    // Save to SQLite (otomatis membuat / memperbarui chat di Layer 1)
                    db.saveMessage({
                        id: messageId,
                        chatJid,
                        senderJid,
                        senderName,
                        fromMe,
                        text,
                        messageType,
                        timestamp,
                        rawJson: msg
                    });

                    // Emit to real-time UI
                    if (ioInstance) {
                        ioInstance.emit('new_message', {
                            id: messageId,
                            chatJid,
                            chat_jid: chatJid,
                            senderJid,
                            sender_jid: senderJid,
                            senderName,
                            sender_name: senderName,
                            fromMe,
                            from_me: fromMe,
                            text,
                            messageType,
                            message_type: messageType,
                            timestamp,
                            isDeleted: 0,
                            is_deleted: 0
                        });
                        ioInstance.emit('chats_updated');
                    }
                } catch (err) {
                    console.error('[WMK] Gagal memproses pesan:', err);
                }
            }
        });

        // Intercept message updates (Another channel for message revokes)
        sock.ev.on('messages.update', async (updates) => {
            const focusJid = db.getFocusJid();
            for (const update of updates) {
                if (focusJid && update.key?.remoteJid !== focusJid) {
                    continue;
                }
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
                            ioInstance.emit('chats_updated');
                        }
                    }
                }
            }
        });

        // Chat synchronization events
        sock.ev.on('chats.upsert', (newChats) => {
            for (const c of newChats) {
                if (!c.id || c.id === 'status@broadcast') continue;
                const normalizedJid = jidNormalizedUser(c.id);
                const contact = db.getContactByJid(normalizedJid);
                const name = contact?.name || null;
                db.upsertChat({
                    jid: normalizedJid,
                    name,
                    phoneNumber: db.formatJidToNumber(normalizedJid),
                    lastMessage: '',
                    lastMessageTime: c.conversationTimestamp ? Number(c.conversationTimestamp) * 1000 : Date.now(),
                    isGroup: normalizedJid.endsWith('@g.us') ? 1 : 0
                });
            }
            if (ioInstance) {
                ioInstance.emit('chats_updated');
            }
        });

        sock.ev.on('chats.update', (chatUpdates) => {
            for (const u of chatUpdates) {
                if (!u.id || u.id === 'status@broadcast') continue;
                const normalizedJid = jidNormalizedUser(u.id);
                if (u.conversationTimestamp) {
                    db.updateChatTimestamp(normalizedJid, Number(u.conversationTimestamp) * 1000);
                }
            }
            if (ioInstance) {
                ioInstance.emit('chats_updated');
            }
        });

        // Contact name and profile sync
        sock.ev.on('contacts.upsert', (contacts) => {
            for (const contact of contacts) {
                if (!contact.id) continue;
                const name = contact.notify || contact.verifiedName || contact.name;
                if (name) {
                    db.saveContact({
                        jid: contact.id,
                        name,
                        phoneNumber: db.formatJidToNumber(contact.id)
                    });
                    const existing = db.getChatByJid(contact.id);
                    if (existing && (!existing.name || existing.name === 'Saya' || existing.name === 'Tanpa Nama')) {
                        db.upsertChat({
                            jid: contact.id,
                            name,
                            phoneNumber: db.formatJidToNumber(contact.id)
                        });
                    }
                }
            }
        });

        sock.ev.on('contacts.update', (contacts) => {
            for (const contact of contacts) {
                if (!contact.id) continue;
                const name = contact.notify || contact.verifiedName || contact.name;
                if (name) {
                    db.saveContact({
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
