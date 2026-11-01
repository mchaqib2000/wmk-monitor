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
    `);
}

initDb();

// Helper to resolve WhatsApp LID (Privacy / Linked ID) to real phone number
function resolveLidToPhone(jid) {
    if (!jid) return '';
    if (jid.endsWith('@lid')) {
        const lidNum = jid.split('@')[0].split(':')[0];
        const mappingFile = path.join(dataDir, 'auth_info_wmk', `lid-mapping-${lidNum}_reverse.json`);
        try {
            if (fs.existsSync(mappingFile)) {
                const raw = fs.readFileSync(mappingFile, 'utf8');
                const cleanPhone = JSON.parse(raw);
                if (cleanPhone) return String(cleanPhone);
            }
        } catch (e) {}
    }
    return jid.split('@')[0].split(':')[0];
}

// Helper to format WhatsApp JID into clean readable phone number (+62 ...)
function formatJidToNumber(jid) {
    if (!jid) return '';
    if (jid.endsWith('@g.us')) return 'Grup WhatsApp';
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

// Save or update chat metadata
function upsertChat({ jid, name, phoneNumber, lastMessage, lastMessageTime, isGroup, isDeleted = 0 }) {
    const isGrp = isGroup ? 1 : (jid.endsWith('@g.us') ? 1 : 0);
    const phone = phoneNumber || formatJidToNumber(jid);
    const displayName = name || phone || 'Tanpa Nama';

    const stmt = db.prepare(`
        INSERT INTO chats (jid, name, phone_number, last_message, last_message_time, last_message_deleted, is_group, updated_at)
        VALUES (@jid, @name, @phoneNumber, @lastMessage, @lastMessageTime, @isDeleted, @isGroup, CURRENT_TIMESTAMP)
        ON CONFLICT(jid) DO UPDATE SET
            name = CASE WHEN @name IS NOT NULL AND @name != '' THEN @name ELSE chats.name END,
            phone_number = CASE WHEN @phoneNumber IS NOT NULL AND @phoneNumber != '' THEN @phoneNumber ELSE chats.phone_number END,
            last_message = CASE WHEN @lastMessage IS NOT NULL THEN @lastMessage ELSE chats.last_message END,
            last_message_time = CASE WHEN @lastMessageTime IS NOT NULL AND @lastMessageTime > chats.last_message_time THEN @lastMessageTime ELSE chats.last_message_time END,
            last_message_deleted = CASE WHEN @isDeleted = 1 THEN 1 ELSE chats.last_message_deleted END,
            updated_at = CURRENT_TIMESTAMP
    `);

    stmt.run({
        jid,
        name: displayName,
        phoneNumber: phone,
        lastMessage: lastMessage || '',
        lastMessageTime: lastMessageTime || Date.now(),
        isDeleted: isDeleted ? 1 : 0,
        isGroup: isGrp
    });
}

// Save message
function saveMessage({ id, chatJid, senderJid, senderName, fromMe, text, messageType = 'text', timestamp, rawJson = null }) {
    const stmt = db.prepare(`
        INSERT OR IGNORE INTO messages (id, chat_jid, sender_jid, sender_name, from_me, text, message_type, timestamp, raw_json)
        VALUES (@id, @chatJid, @senderJid, @senderName, @fromMe, @text, @messageType, @timestamp, @rawJson)
    `);

    stmt.run({
        id,
        chatJid,
        senderJid,
        senderName: senderName || '',
        fromMe: fromMe ? 1 : 0,
        text: text || '',
        messageType,
        timestamp: timestamp || Date.now(),
        rawJson: rawJson ? JSON.stringify(rawJson) : null
    });

    // Also update last message in chat
    upsertChat({
        jid: chatJid,
        name: senderName,
        lastMessage: text,
        lastMessageTime: timestamp,
        isDeleted: 0
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

    return db.prepare(sql).all(...params);
}

// Get specific chat metadata
function getChatByJid(jid) {
    return db.prepare('SELECT * FROM chats WHERE jid = ?').get(jid);
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

// Reset data (optional admin action)
function clearAllData() {
    db.exec(`
        DELETE FROM messages;
        DELETE FROM chats;
    `);
}

module.exports = {
    initDb,
    upsertChat,
    saveMessage,
    markMessageAsDeleted,
    getChats,
    getChatByJid,
    getMessagesForChat,
    formatJidToNumber,
    clearAllData
};
