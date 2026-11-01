const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'wmk_monitor.db');
const db = new Database(dbPath);

// Enable WAL mode for high performance & concurrency
db.pragma('journal_mode = WAL');

// Initialize database schema
function initDb() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS chats (
            jid TEXT PRIMARY KEY,
            name TEXT,
            phone_number TEXT,
            last_message TEXT,
            last_message_time INTEGER,
            last_message_deleted INTEGER DEFAULT 0,
            unread_count INTEGER DEFAULT 0,
            is_group INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            chat_jid TEXT NOT NULL,
            sender_jid TEXT,
            sender_name TEXT,
            from_me INTEGER DEFAULT 0,
            text TEXT,
            message_type TEXT DEFAULT 'text',
            timestamp INTEGER NOT NULL,
            is_deleted INTEGER DEFAULT 0,
            deleted_at DATETIME,
            raw_json TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_messages_chat_time ON messages(chat_jid, timestamp);
        CREATE INDEX IF NOT EXISTS idx_messages_deleted ON messages(is_deleted);
        CREATE INDEX IF NOT EXISTS idx_chats_last_time ON chats(last_message_time DESC);

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        );

        CREATE TABLE IF NOT EXISTS contacts (
            jid TEXT PRIMARY KEY,
            name TEXT,
            phone_number TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // Ensure last_message_from_me column exists in chats
    try {
        db.prepare('ALTER TABLE chats ADD COLUMN last_message_from_me INTEGER DEFAULT 0').run();
    } catch (e) {}
}

initDb();

// Helper to resolve WhatsApp LID (Privacy / Linked ID) to real phone number
function resolveLidToPhone(jid) {
    if (!jid) return '';
    const cleanJid = String(jid).replace(/^\+/, '');
    const lidNum = cleanJid.split('@')[0].split(':')[0];
    const mappingFile = path.join(dataDir, 'auth_info_wmk', `lid-mapping-${lidNum}_reverse.json`);
    try {
        if (fs.existsSync(mappingFile)) {
            const raw = fs.readFileSync(mappingFile, 'utf8');
            const cleanPhone = JSON.parse(raw);
            if (cleanPhone) return String(cleanPhone);
        }
    } catch (e) {}
    return lidNum;
}

// Helper to format WhatsApp JID into clean readable phone number (+62 ...)
function formatJidToNumber(jid) {
    if (!jid) return '';
    if (String(jid).endsWith('@g.us')) return 'Grup WhatsApp';
    const numberOnly = resolveLidToPhone(jid);
    const clean = String(numberOnly).replace(/[^0-9]/g, '');
    if (clean.startsWith('62')) {
        return `+62 ${clean.slice(2, 5)}-${clean.slice(5, 9)}-${clean.slice(9)}`;
    }
    if (clean.startsWith('08')) {
        return `+62 ${clean.slice(1, 4)}-${clean.slice(4, 8)}-${clean.slice(8)}`;
    }
    return `+${clean}`;
}

// Refresh and update any existing chats that stored raw LID numbers
function refreshExistingChatNumbers() {
    try {
        const chats = db.prepare('SELECT jid, phone_number FROM chats').all();
        for (const chat of chats) {
            const resolved = formatJidToNumber(chat.jid);
            if (resolved && resolved !== chat.phone_number) {
                db.prepare('UPDATE chats SET phone_number = ? WHERE jid = ?').run(resolved, chat.jid);
            }
        }
    } catch (e) {
        console.error('Gagal memperbarui nomor LID:', e);
    }
}

refreshExistingChatNumbers();

// Contact management helpers
function saveContact({ jid, name, phoneNumber }) {
    if (!jid || !name) return;
    const phone = phoneNumber || formatJidToNumber(jid);
    db.prepare(`
        INSERT INTO contacts (jid, name, phone_number, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(jid) DO UPDATE SET
            name = excluded.name,
            phone_number = excluded.phone_number,
            updated_at = CURRENT_TIMESTAMP
    `).run(jid, name, phone);
}

function getContactByJid(jid) {
    if (!jid) return null;
    const cleanJid = String(jid).split(':')[0];
    let row = db.prepare('SELECT * FROM contacts WHERE jid = ?').get(cleanJid);
    if (!row) {
        const resolved = resolveLidToPhone(jid);
        if (resolved) {
            row = db.prepare('SELECT * FROM contacts WHERE phone_number LIKE ? OR jid LIKE ?').get(`%${resolved}%`, `%${resolved}%`);
        }
    }
    return row;
}

// Save or update chat metadata
function upsertChat({ jid, name, phoneNumber, lastMessage, lastMessageTime, isGroup, isDeleted = 0, isFromMe = 0 }) {
    if (!jid) return;
    const isGrp = isGroup ? 1 : (jid.endsWith('@g.us') ? 1 : 0);
    const phone = phoneNumber || formatJidToNumber(jid);

    // Look up contact name if name is empty or was 'Saya'
    let finalName = name;
    if (!finalName || finalName === 'Saya') {
        const contact = getContactByJid(jid);
        if (contact && contact.name) {
            finalName = contact.name;
        }
    }
    const displayName = finalName || phone || 'Tanpa Nama';

    const stmt = db.prepare(`
        INSERT INTO chats (jid, name, phone_number, last_message, last_message_time, last_message_deleted, last_message_from_me, is_group, updated_at)
        VALUES (@jid, @name, @phoneNumber, @lastMessage, @lastMessageTime, @isDeleted, @isFromMe, @isGroup, CURRENT_TIMESTAMP)
        ON CONFLICT(jid) DO UPDATE SET
            name = CASE 
                WHEN @name IS NOT NULL AND @name != '' AND @name != 'Saya' THEN @name 
                ELSE chats.name 
            END,
            phone_number = CASE 
                WHEN @phoneNumber IS NOT NULL AND @phoneNumber != '' THEN @phoneNumber 
                ELSE chats.phone_number 
            END,
            last_message = CASE 
                WHEN @lastMessage IS NOT NULL THEN @lastMessage 
                ELSE chats.last_message 
            END,
            last_message_time = CASE 
                WHEN @lastMessageTime IS NOT NULL AND @lastMessageTime >= chats.last_message_time THEN @lastMessageTime 
                ELSE chats.last_message_time 
            END,
            last_message_deleted = CASE 
                WHEN @isDeleted = 1 THEN 1 
                ELSE chats.last_message_deleted 
            END,
            last_message_from_me = @isFromMe,
            updated_at = CURRENT_TIMESTAMP
    `);

    stmt.run({
        jid,
        name: displayName,
        phoneNumber: phone,
        lastMessage: lastMessage !== undefined ? lastMessage : '',
        lastMessageTime: lastMessageTime || Date.now(),
        isDeleted: isDeleted ? 1 : 0,
        isFromMe: isFromMe ? 1 : 0,
        isGroup: isGrp
    });
}

function updateChatTimestamp(jid, timestamp) {
    if (!jid || !timestamp) return;
    db.prepare(`
        UPDATE chats 
        SET last_message_time = CASE WHEN ? > last_message_time THEN ? ELSE last_message_time END,
            updated_at = CURRENT_TIMESTAMP
        WHERE jid = ?
    `).run(timestamp, timestamp, jid);
}

// Save message
function saveMessage({ id, chatJid, senderJid, senderName, fromMe, text, messageType = 'text', timestamp, rawJson = null }) {
    const isFromMe = (fromMe === 1 || fromMe === true) ? 1 : 0;
    const stmt = db.prepare(`
        INSERT OR IGNORE INTO messages (id, chat_jid, sender_jid, sender_name, from_me, text, message_type, timestamp, raw_json)
        VALUES (@id, @chatJid, @senderJid, @senderName, @fromMe, @text, @messageType, @timestamp, @rawJson)
    `);

    stmt.run({
        id,
        chatJid,
        senderJid,
        senderName: senderName || '',
        fromMe: isFromMe,
        text: text || '',
        messageType,
        timestamp: timestamp || Date.now(),
        rawJson: rawJson ? JSON.stringify(rawJson) : null
    });

    // If incoming message, senderName is the contact's name.
    // If outgoing message (fromMe), do NOT set chat.name to 'Saya' or senderName!
    const chatContactName = isFromMe ? null : senderName;

    // Update or insert chat row on Layer 1
    upsertChat({
        jid: chatJid,
        name: chatContactName,
        lastMessage: text,
        lastMessageTime: timestamp,
        isDeleted: 0,
        isFromMe: isFromMe
    });
}

// Mark message as deleted (REVOKE event captured)
function markMessageAsDeleted(messageId) {
    // Check if message exists first
    const existing = db.prepare('SELECT chat_jid, text FROM messages WHERE id = ?').get(messageId);
    
    const stmt = db.prepare(`
        UPDATE messages
        SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `);
    const info = stmt.run(messageId);

    if (existing) {
        // If this message was the latest message in chats table, update the chat flag
        const latestMsg = db.prepare(`
            SELECT id FROM messages 
            WHERE chat_jid = ? 
            ORDER BY timestamp DESC 
            LIMIT 1
        `).get(existing.chat_jid);

        if (latestMsg && latestMsg.id === messageId) {
            db.prepare(`UPDATE chats SET last_message_deleted = 1 WHERE jid = ?`).run(existing.chat_jid);
        }
    }

    return { success: info.changes > 0, existing };
}

// Get all chats for chat list screen (ordered by last message time DESC)
function getChats(query = '') {
    let sql = `
        SELECT 
            c.*,
            (SELECT COUNT(*) FROM messages m WHERE m.chat_jid = c.jid AND m.is_deleted = 1) AS deleted_messages_count
        FROM chats c
    `;
    const params = [];

    if (query && query.trim() !== '') {
        sql += ` WHERE c.name LIKE ? OR c.phone_number LIKE ? OR c.last_message LIKE ? `;
        const q = `%${query.trim()}%`;
        params.push(q, q, q);
    }

    sql += ` ORDER BY c.last_message_time DESC`;

    const chats = db.prepare(sql).all(...params);
    return chats.map(c => {
        const resolved = formatJidToNumber(c.jid);
        return {
            ...c,
            phone_number: (resolved && resolved !== c.phone_number) ? resolved : c.phone_number
        };
    });
}

// Get specific chat metadata
function getChatByJid(jid) {
    const chat = db.prepare('SELECT * FROM chats WHERE jid = ?').get(jid);
    if (!chat) return null;
    const resolved = formatJidToNumber(chat.jid);
    return {
        ...chat,
        phone_number: (resolved && resolved !== chat.phone_number) ? resolved : chat.phone_number
    };
}

// Get messages for chat view
function getMessagesForChat(chatJid, limit = 200) {
    const stmt = db.prepare(`
        SELECT 
            id,
            chat_jid,
            sender_jid,
            sender_name,
            from_me,
            text,
            message_type,
            timestamp,
            is_deleted,
            deleted_at
        FROM messages
        WHERE chat_jid = ?
        ORDER BY timestamp ASC
        LIMIT ?
    `);
    return stmt.all(chatJid, limit);
}

// Focus Mode Settings
function getFocusJid() {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('focus_chat_jid');
    return row ? row.value : null;
}

function setFocusJid(jid) {
    db.prepare(`
        INSERT INTO settings (key, value) VALUES ('focus_chat_jid', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(jid);
    return jid;
}

function clearFocusJid() {
    db.prepare("DELETE FROM settings WHERE key = 'focus_chat_jid'").run();
    return null;
}

// Clear all messages & remove chat from Layer 1 (Fitur Layer 1)
function clearChatMessages(chatJid) {
    db.prepare('DELETE FROM messages WHERE chat_jid = ?').run(chatJid);
    db.prepare('DELETE FROM chats WHERE jid = ?').run(chatJid);
    return true;
}

// Delete single selected message (Fitur Layer 2)
function deleteMessageById(messageId) {
    const msg = db.prepare('SELECT chat_jid FROM messages WHERE id = ?').get(messageId);
    if (!msg) return false;

    db.prepare('DELETE FROM messages WHERE id = ?').run(messageId);

    // Refresh last message of the chat
    const latest = db.prepare(`
        SELECT text, timestamp, is_deleted 
        FROM messages 
        WHERE chat_jid = ? 
        ORDER BY timestamp DESC 
        LIMIT 1
    `).get(msg.chat_jid);

    if (latest) {
        db.prepare(`
            UPDATE chats 
            SET last_message = ?, last_message_time = ?, last_message_deleted = ? 
            WHERE jid = ?
        `).run(latest.text, latest.timestamp, latest.is_deleted, msg.chat_jid);
    } else {
        db.prepare(`
            UPDATE chats 
            SET last_message = '', last_message_deleted = 0 
            WHERE jid = ?
        `).run(msg.chat_jid);
    }

    return true;
}

// Batch delete multiple chats and their messages (Fitur Hapus Batch Pesan Layer 1)
function batchDeleteChats(jids) {
    if (!Array.isArray(jids) || jids.length === 0) return 0;
    const placeholders = jids.map(() => '?').join(',');
    
    const tx = db.transaction((targets) => {
        db.prepare(`DELETE FROM messages WHERE chat_jid IN (${placeholders})`).run(...targets);
        const info = db.prepare(`DELETE FROM chats WHERE jid IN (${placeholders})`).run(...targets);
        return info.changes;
    });

    return tx(jids);
}

// Reset data (optional admin action)
function clearAllData() {
    db.exec(`
        DELETE FROM messages;
        DELETE FROM chats;
        DELETE FROM settings;
    `);
}

module.exports = {
    initDb,
    upsertChat,
    saveMessage,
    saveContact,
    getContactByJid,
    updateChatTimestamp,
    markMessageAsDeleted,
    getChats,
    getChatByJid,
    getMessagesForChat,
    formatJidToNumber,
    getFocusJid,
    setFocusJid,
    clearFocusJid,
    clearChatMessages,
    deleteMessageById,
    batchDeleteChats,
    clearAllData
};
