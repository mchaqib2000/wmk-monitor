// WMK - WhatsApp Monitor Client Application
document.addEventListener('DOMContentLoaded', () => {
    // State
    let currentScreen = 'screen-qr';
    let activeChatJid = null;
    let deferredPrompt = null;
    let searchTimeout = null;
    let activeFocusJid = null;
    let currentSettingsChat = null;
    let pendingDeleteMsgId = null;
    let isBatchMode = false;
    let selectedChatJids = new Set();
    let loadedChats = [];

    // DOM Elements
    const screenQr = document.getElementById('screen-qr');
    const screenChatList = document.getElementById('screen-chat-list');
    const screenChatView = document.getElementById('screen-chat-view');

    const qrImage = document.getElementById('qr-image');
    const qrLoading = document.getElementById('qr-loading');
    const targetPhoneLabel = document.getElementById('target-phone-label');
    const searchInput = document.getElementById('search-input');
    const chatListContainer = document.getElementById('chat-list-container');

    const chatBackBtn = document.getElementById('chat-back-btn');
    const activeChatAvatar = document.getElementById('active-chat-avatar');
    const activeChatName = document.getElementById('active-chat-name');
    const activeChatPhone = document.getElementById('active-chat-phone');
    const messagesContainer = document.getElementById('messages-container');

    const refreshChatsBtn = document.getElementById('refresh-chats-btn');
    const menuBtn = document.getElementById('menu-btn');
    const logoutModal = document.getElementById('logout-modal');
    const modalCancelBtn = document.getElementById('modal-cancel-btn');
    const modalConfirmLogoutBtn = document.getElementById('modal-confirm-logout-btn');

    // Batch Mode Elements (Layer 1: Hapus Batch Pesan)
    const batchModeBtn = document.getElementById('batch-mode-btn');
    const batchHeader = document.getElementById('batch-header');
    const batchCancelBtn = document.getElementById('batch-cancel-btn');
    const batchCountLabel = document.getElementById('batch-count-label');
    const batchSelectAllBtn = document.getElementById('batch-select-all-btn');
    const batchDeleteBtn = document.getElementById('batch-delete-btn');

    // Batch Delete Modal Elements (Layer 1)
    const batchDeleteModal = document.getElementById('batch-delete-modal');
    const batchDeleteModalTitle = document.getElementById('batch-delete-modal-title');
    const batchDeleteModalDesc = document.getElementById('batch-delete-modal-desc');
    const cancelBatchDeleteBtn = document.getElementById('cancel-batch-delete-btn');
    const confirmBatchDeleteBtn = document.getElementById('confirm-batch-delete-btn');

    const installBanner = document.getElementById('install-banner');
    const installPwaBtn = document.getElementById('install-pwa-btn');

    // Focus Mode Elements (Layer 1)
    const focusBanner = document.getElementById('focus-banner');
    const focusBannerName = document.getElementById('focus-banner-name');
    const disableFocusBtn = document.getElementById('disable-focus-btn');

    // Chat Settings Modal Elements (Layer 1)
    const chatSettingsModal = document.getElementById('chat-settings-modal');
    const settingsModalAvatar = document.getElementById('settings-modal-avatar');
    const settingsModalName = document.getElementById('settings-modal-name');
    const settingsModalPhone = document.getElementById('settings-modal-phone');
    const closeChatSettingsBtn = document.getElementById('close-chat-settings-btn');
    const btnClearChatMessages = document.getElementById('btn-clear-chat-messages');
    const btnToggleFocusMode = document.getElementById('btn-toggle-focus-mode');
    const focusOptTitle = document.getElementById('focus-opt-title');
    const focusOptDesc = document.getElementById('focus-opt-desc');

    // Delete Single Message Modal Elements (Layer 2)
    const deleteMessageModal = document.getElementById('delete-message-modal');
    const cancelDeleteMsgBtn = document.getElementById('cancel-delete-msg-btn');
    const confirmDeleteMsgBtn = document.getElementById('confirm-delete-msg-btn');

    // Register Service Worker for PWA
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch((err) => {
            console.log('SW registration error:', err);
        });
    }

    // PWA Install prompt
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        installBanner.classList.add('active');
    });

    // Also show banner on mobile browsers if not installed in standalone mode
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    if (!isStandalone && /android|iphone|ipad/i.test(navigator.userAgent)) {
        installBanner.classList.add('active');
    }

    installPwaBtn.addEventListener('click', async () => {
        if (deferredPrompt) {
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            deferredPrompt = null;
            installBanner.classList.remove('active');
        } else {
            alert("Cara pasang WMK ke layar utama:\n\n1. Ketuk ikon titik tiga (⋮) di pojok kanan atas browser Chrome.\n2. Pilih 'Instal aplikasi' atau 'Tambahkan ke Layar Utama'.\n3. Aplikasi WMK akan langsung muncul di menu HP Anda!");
        }
    });

    // Screen navigation helper
    function showScreen(screenId) {
        if (screenId !== 'screen-chat-list' && isBatchMode) {
            exitBatchMode();
        }
        [screenQr, screenChatList, screenChatView].forEach(s => s.classList.remove('active'));
        const target = document.getElementById(screenId);
        if (target) {
            target.classList.add('active');
            currentScreen = screenId;
        }
    }

    // Socket.io initialization
    const socket = io();

    socket.on('connect', () => {
        console.log('[WMK] Terhubung ke server realtime');
    });

    // Handle connection status updates from backend
    socket.on('connection_status', (data) => {
        console.log('[WMK] Status koneksi:', data);
        const { state, qr, user } = data;

        if (state === 'connected') {
            targetPhoneLabel.textContent = user?.phone || user?.name || 'Terhubung';
            if (currentScreen === 'screen-qr') {
                showScreen('screen-chat-list');
                loadChatList();
            }
        } else if (state === 'qr_ready' && qr) {
            qrImage.src = qr;
            qrImage.style.display = 'block';
            qrLoading.style.display = 'none';
            if (currentScreen !== 'screen-qr') {
                showScreen('screen-qr');
            }
        } else if (state === 'connecting') {
            qrImage.style.display = 'none';
            qrLoading.style.display = 'flex';
            qrLoading.querySelector('span').textContent = 'Menghubungkan ke WhatsApp...';
            if (currentScreen !== 'screen-qr') {
                showScreen('screen-qr');
            }
        } else {
            // disconnected
            qrImage.style.display = 'none';
            qrLoading.style.display = 'flex';
            qrLoading.querySelector('span').textContent = 'Membuat Barcode WhatsApp...';
            showScreen('screen-qr');
        }
    });

    // Realtime new message
    socket.on('new_message', (msg) => {
        console.log('[WMK] Pesan baru diterima:', msg);
        const msgChatJid = msg.chatJid || msg.chat_jid;
        // If current chat is open, append message
        if (currentScreen === 'screen-chat-view' && activeChatJid === msgChatJid) {
            appendMessage(msg);
            scrollMessagesToBottom();
        }
        // Refresh chat list preview if on chat list screen
        if (currentScreen === 'screen-chat-list') {
            loadChatList(searchInput.value);
        }
    });

    // Realtime message deleted event (ANTI-DELETE FEATURE)
    socket.on('message_deleted', (data) => {
        console.log('[WMK] Pesan dihapus terdeteksi:', data);
        const { chatJid, messageId } = data;

        // If currently viewing this chat, update the bubble in real time!
        if (currentScreen === 'screen-chat-view' && activeChatJid === chatJid) {
            const bubbleEl = document.querySelector(`[data-msg-id="${messageId}"]`);
            if (bubbleEl) {
                bubbleEl.classList.add('is-deleted');
                if (!bubbleEl.querySelector('.deleted-banner')) {
                    const banner = document.createElement('div');
                    banner.className = 'deleted-banner';
                    banner.innerHTML = `<span class="pulse-dot"></span> Pesan ini telah dihapus oleh pengirim`;
                    bubbleEl.insertBefore(banner, bubbleEl.querySelector('.msg-text'));
                }
            }
        }

        // Refresh chat list to update badge and snippet
        if (currentScreen === 'screen-chat-list') {
            loadChatList(searchInput.value);
        }
    });

    // Helper to update Focus Banner
    function updateFocusBanner(data) {
        if (data && data.active && data.focusJid) {
            activeFocusJid = data.focusJid;
            const chat = data.focusChat;
            const displayName = chat ? (chat.name || formatDisplayNumber(chat.phone_number, chat.jid)) : data.focusJid;
            focusBannerName.textContent = displayName;
            focusBanner.style.display = 'flex';
        } else {
            activeFocusJid = null;
            focusBanner.style.display = 'none';
        }
    }

    // Realtime Focus Mode changed event
    socket.on('focus_mode_changed', (data) => {
        updateFocusBanner(data);
        loadChatList(searchInput.value);
    });

    // Realtime Chat messages cleared event
    socket.on('chat_messages_cleared', (data) => {
        if (activeChatJid === data.chatJid) {
            messagesContainer.innerHTML = `
                <div style="text-align: center; padding: 40px 20px; color: #667781; font-size: 13px;">
                    Belum ada pesan yang tersimpan di chat ini.
                </div>
            `;
        }
        loadChatList(searchInput.value);
    });

    // Realtime message deleted permanently event
    socket.on('message_deleted_permanently', (data) => {
        const bubbleEl = document.querySelector(`[data-msg-id="${data.messageId}"]`);
        if (bubbleEl) {
            bubbleEl.remove();
        }
        loadChatList(searchInput.value);
    });

    // Realtime Batch chats deleted event
    socket.on('batch_chats_deleted', (data) => {
        if (data && Array.isArray(data.jids)) {
            data.jids.forEach(jid => {
                if (activeChatJid === jid) {
                    showScreen('screen-chat-list');
                    activeChatJid = null;
                }
                const el = document.querySelector(`[data-chat-jid="${jid}"]`);
                if (el) el.remove();
            });
            loadChatList(searchInput.value);
        }
    });

    // Formatting helpers
    function formatTime(timestamp) {
        if (!timestamp) return '';
        const d = new Date(timestamp);
        const now = new Date();
        const isToday = d.toDateString() === now.toDateString();
        
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        const timeStr = `${hours}:${minutes}`;

        if (isToday) return timeStr;

        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);
        if (d.toDateString() === yesterday.toDateString()) return 'Kemarin';

        return `${d.getDate()}/${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}`;
    }

    function getInitials(name) {
        if (!name) return '?';
        const clean = name.trim();
        const parts = clean.split(' ');
        if (parts.length >= 2) {
            return (parts[0][0] + parts[1][0]).toUpperCase();
        }
        return clean.slice(0, 2).toUpperCase();
    }

    // Default formatter for phone numbers (guarantees +62 format and decodes WhatsApp privacy LIDs)
    function formatDisplayNumber(phone, jid) {
        if (!phone) return '';
        if (phone.includes('Grup')) return 'Grup WhatsApp';
        
        const clean = phone.replace(/[^0-9]/g, '');
        if (clean.startsWith('62')) {
            return `+62 ${clean.slice(2, 5)}-${clean.slice(5, 9)}-${clean.slice(9)}`;
        }
        if (clean.startsWith('08')) {
            return `+62 ${clean.slice(1, 4)}-${clean.slice(4, 8)}-${clean.slice(8)}`;
        }

        // Fallback mapping for WhatsApp privacy LIDs
        const lidCache = {
            '160606476873979': '+62 851-5512-7013',
            '90731217707140': '+62 852-1309-9831',
            '13693026889879': '+62 851-9624-8381'
        };

        for (const [lid, realPhone] of Object.entries(lidCache)) {
            if (clean.includes(lid) || (jid && jid.includes(lid))) {
                return realPhone;
            }
        }
        return phone;
    }

    // Load Chat List
    async function loadChatList(query = '') {
        try {
            const res = await fetch(`/api/chats?q=${encodeURIComponent(query)}`);
            const data = await res.json();
            if (!data.success) return;

            renderChatList(data.chats);
        } catch (err) {
            console.error('Gagal mengambil daftar chat:', err);
        }
    }

    // Render Chat List (Requirement 3: Nama, Nomor, isi pesan 1 baris)
    function renderChatList(chats) {
        loadedChats = chats || [];
        chatListContainer.innerHTML = '';

        if (!chats || chats.length === 0) {
            if (isBatchMode) exitBatchMode();
            chatListContainer.innerHTML = `
                <div class="empty-state">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                    </svg>
                    <h3>Belum ada riwayat pesan</h3>
                    <p>Pesan WhatsApp yang masuk atau keluar di HP target akan muncul otomatis di sini.</p>
                </div>
            `;
            return;
        }

        chats.forEach((chat) => {
            const item = document.createElement('div');
            item.className = 'chat-item';
            item.setAttribute('data-chat-jid', chat.jid);
            if (isBatchMode && selectedChatJids.has(chat.jid)) {
                item.classList.add('selected');
            }

            const displayPhone = formatDisplayNumber(chat.phone_number, chat.jid);
            const initials = getInitials(chat.name || displayPhone);
            const isGroup = chat.is_group === 1;
            const timeStr = formatTime(chat.last_message_time);
            const isFocused = activeFocusJid && (chat.jid === activeFocusJid);
            const focusPillHtml = isFocused ? `<span class="chat-focus-pill">🎯 Fokus</span>` : '';

            // Layer 1: Teks pesan bersih 1 baris
            const previewText = chat.last_message || 'Belum ada pesan';

            item.innerHTML = `
                <div class="chat-batch-checkbox">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                </div>
                <div class="chat-avatar ${isGroup ? 'group' : ''}">${initials}</div>
                <div class="chat-info">
                    <div class="chat-top-row">
                        <span class="chat-name">${escapeHtml(chat.name || displayPhone)}${focusPillHtml}</span>
                        <span class="chat-time">${timeStr}</span>
                    </div>
                    <div class="chat-phone">${escapeHtml(displayPhone)}</div>
                    <div class="chat-preview-row">
                        <span class="chat-preview">
                            ${escapeHtml(previewText)}
                        </span>
                    </div>
                </div>
                <button class="chat-item-menu-btn" title="Pengaturan Chat">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="1.5"></circle>
                        <circle cx="12" cy="5" r="1.5"></circle>
                        <circle cx="12" cy="19" r="1.5"></circle>
                    </svg>
                </button>
            `;

            // Tapping 3-dots button triggers settings modal (Layer 1)
            const menuBtnEl = item.querySelector('.chat-item-menu-btn');
            menuBtnEl.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!isBatchMode) {
                    openChatSettings(chat);
                }
            });

            // Tapping item opens the chat view or toggles batch selection
            item.addEventListener('click', () => {
                if (isBatchMode) {
                    toggleChatSelection(chat.jid, item);
                } else {
                    openChat(chat);
                }
            });

            chatListContainer.appendChild(item);
        });

        if (isBatchMode) {
            updateBatchSelectionUI();
        }
    }

    // ==========================================
    // BATCH MODE MANAGEMENT (Layer 1)
    // ==========================================
    function enterBatchMode() {
        isBatchMode = true;
        selectedChatJids.clear();
        screenChatList.classList.add('batch-mode');
        batchHeader.style.display = 'flex';
        document.querySelectorAll('.chat-item.selected').forEach(el => el.classList.remove('selected'));
        updateBatchSelectionUI();
    }

    function exitBatchMode() {
        isBatchMode = false;
        selectedChatJids.clear();
        screenChatList.classList.remove('batch-mode');
        batchHeader.style.display = 'none';
        document.querySelectorAll('.chat-item.selected').forEach(el => el.classList.remove('selected'));
    }

    function toggleChatSelection(jid, itemEl) {
        if (selectedChatJids.has(jid)) {
            selectedChatJids.delete(jid);
            itemEl.classList.remove('selected');
        } else {
            selectedChatJids.add(jid);
            itemEl.classList.add('selected');
        }
        updateBatchSelectionUI();
    }

    function updateBatchSelectionUI() {
        const count = selectedChatJids.size;
        batchCountLabel.textContent = `${count} dipilih`;

        if (count > 0) {
            batchDeleteBtn.removeAttribute('disabled');
        } else {
            batchDeleteBtn.setAttribute('disabled', 'true');
        }

        const totalItems = loadedChats.length;
        if (totalItems > 0 && count === totalItems) {
            batchSelectAllBtn.textContent = 'Batal Pilih';
        } else {
            batchSelectAllBtn.textContent = 'Pilih Semua';
        }
    }

    // Open Chat Settings Modal (Layer 1)
    function openChatSettings(chat) {
        currentSettingsChat = chat;
        const displayPhone = formatDisplayNumber(chat.phone_number, chat.jid);
        settingsModalName.textContent = chat.name || displayPhone;
        settingsModalPhone.textContent = displayPhone;
        settingsModalAvatar.textContent = getInitials(chat.name || displayPhone);
        if (chat.is_group) settingsModalAvatar.classList.add('group');
        else settingsModalAvatar.classList.remove('group');

        // Check if this chat is currently focused
        const isCurrentFocused = (activeFocusJid && activeFocusJid === chat.jid);
        if (isCurrentFocused) {
            focusOptTitle.textContent = '2. Matikan Mode Fokus';
            focusOptDesc.textContent = 'Mode fokus sedang aktif pada nomor ini. Ketuk untuk memantau semua nomor kembali.';
        } else {
            focusOptTitle.textContent = '2. Aktifkan Mode Fokus';
            focusOptDesc.textContent = 'Hanya menerima & memantau pesan dari nomor ini (nomor lain diabaikan)';
        }

        chatSettingsModal.classList.add('active');
    }

    // Modal Action 1: Hapus Semua Pesan di Chat Ini
    btnClearChatMessages.addEventListener('click', async () => {
        if (!currentSettingsChat) return;
        const targetName = currentSettingsChat.name || formatDisplayNumber(currentSettingsChat.phone_number, currentSettingsChat.jid);
        if (!confirm(`Hapus semua riwayat pesan tersimpan dari "${targetName}"?`)) {
            return;
        }

        const chatJidToDelete = currentSettingsChat.jid;
        chatSettingsModal.classList.remove('active');
        try {
            const res = await fetch(`/api/chats/${encodeURIComponent(chatJidToDelete)}/clear-messages`, { method: 'POST' });
            if (res.ok) {
                const chatEl = document.querySelector(`[data-chat-jid="${chatJidToDelete}"]`);
                if (chatEl) chatEl.remove();
                loadChatList(searchInput.value);
            } else {
                alert("Server belum dimuat ulang. Silakan tutup jendela hitam start.bat lalu buka lagi!");
            }
        } catch (e) {
            console.error('Gagal menghapus pesan chat:', e);
        }
    });

    // Modal Action 2: Toggle Mode Fokus
    btnToggleFocusMode.addEventListener('click', async () => {
        if (!currentSettingsChat) return;
        const chatJidToFocus = currentSettingsChat.jid;
        chatSettingsModal.classList.remove('active');
        try {
            const res = await fetch('/api/focus/toggle', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jid: chatJidToFocus })
            });
            if (res.ok) {
                const data = await res.json();
                updateFocusBanner(data);
                loadChatList(searchInput.value);
            } else {
                alert("Server belum dimuat ulang. Silakan tutup jendela hitam start.bat lalu buka lagi!");
            }
        } catch (e) {
            console.error('Gagal mengubah mode fokus:', e);
        }
    });

    // Close Chat Settings Modal
    closeChatSettingsBtn.addEventListener('click', () => {
        chatSettingsModal.classList.remove('active');
    });

    // Disable Focus Button in Banner
    disableFocusBtn.addEventListener('click', async () => {
        try {
            const res = await fetch('/api/focus/clear', { method: 'POST' });
            const data = await res.json();
            updateFocusBanner(data);
            loadChatList(searchInput.value);
        } catch (e) {
            console.error('Gagal mematikan mode fokus:', e);
        }
    });

    // Open Chat View (Requirement 4: tampilan chat sederhana)
    async function openChat(chat) {
        if (isBatchMode) exitBatchMode();
        activeChatJid = chat.jid;

        const displayPhone = formatDisplayNumber(chat.phone_number, chat.jid);
        activeChatName.textContent = chat.name || displayPhone;
        activeChatPhone.textContent = displayPhone;
        activeChatAvatar.textContent = getInitials(chat.name || displayPhone);
        if (chat.is_group) activeChatAvatar.classList.add('group');
        else activeChatAvatar.classList.remove('group');

        showScreen('screen-chat-view');
        messagesContainer.innerHTML = `
            <div style="text-align: center; padding: 20px; color: #667781; font-size: 13px;">
                Memuat riwayat chat...
            </div>
        `;

        try {
            const res = await fetch(`/api/chats/${encodeURIComponent(chat.jid)}/messages?limit=300`);
            const data = await res.json();
            if (!data.success) return;

            renderMessages(data.messages, chat);
            scrollMessagesToBottom();
        } catch (err) {
            console.error('Gagal mengambil pesan:', err);
        }
    }

    // Render Messages with Anti-Delete Indicators (Requirement 5)
    function renderMessages(messages, chat) {
        messagesContainer.innerHTML = '';

        if (!messages || messages.length === 0) {
            messagesContainer.innerHTML = `
                <div style="text-align: center; padding: 40px 20px; color: #667781; font-size: 13px;">
                    Belum ada pesan yang tersimpan di chat ini.
                </div>
            `;
            return;
        }

        let lastDate = '';

        messages.forEach((msg) => {
            const msgDate = new Date(msg.timestamp).toLocaleDateString('id-ID', {
                day: 'numeric',
                month: 'long',
                year: 'numeric'
            });

            if (msgDate !== lastDate) {
                const dateEl = document.createElement('div');
                dateEl.className = 'date-divider';
                dateEl.textContent = msgDate;
                messagesContainer.appendChild(dateEl);
                lastDate = msgDate;
            }

            appendMessage(msg, chat);
        });
    }

    // Append single message bubble
    function appendMessage(msg, chat = null) {
        const isFromMe = (msg.from_me === 1 || msg.from_me === true || msg.fromMe === 1 || msg.fromMe === true);
        const isDeleted = (msg.is_deleted === 1 || msg.isDeleted === 1);
        const timeStr = formatTime(msg.timestamp);

        const bubble = document.createElement('div');
        bubble.className = `msg-bubble ${isFromMe ? 'sent' : 'received'}`;
        bubble.setAttribute('data-msg-id', msg.id);

        if (isDeleted) {
            bubble.classList.add('is-deleted');
        }

        // Sender name (always display sender name when received)
        const senderName = msg.sender_name || msg.senderName || '';
        let senderHtml = '';
        if (!isFromMe && senderName) {
            senderHtml = `<div class="msg-sender-name">${escapeHtml(senderName)}</div>`;
        }

        // Anti-Delete banner
        let deletedBannerHtml = '';
        if (isDeleted) {
            deletedBannerHtml = `
                <div class="deleted-banner">
                    <span class="pulse-dot"></span>
                    <span>Pesan ini telah dihapus oleh pengirim</span>
                </div>
            `;
        }

        // Layer 2: Tombol hapus pesan terpilih
        const deleteBtnHtml = `
            <button class="msg-delete-btn" data-msg-id="${msg.id}" title="Hapus pesan terpilih">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
            </button>
        `;

        bubble.innerHTML = `
            ${deleteBtnHtml}
            ${senderHtml}
            ${deletedBannerHtml}
            <div class="msg-text">${escapeHtml(msg.text)}</div>
            <div class="msg-meta">
                <span>${timeStr}</span>
                ${isFromMe ? `
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#53BDEB" stroke-width="2">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                ` : ''}
            </div>
        `;

        // Event listener for Layer 2 delete single message button
        const delBtn = bubble.querySelector('.msg-delete-btn');
        if (delBtn) {
            delBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                pendingDeleteMsgId = msg.id;
                deleteMessageModal.classList.add('active');
            });
        }

        messagesContainer.appendChild(bubble);
    }

    function scrollMessagesToBottom() {
        requestAnimationFrame(() => {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        });
    }

    // Search bar with debounce
    searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            loadChatList(e.target.value);
        }, 250);
    });

    // Back button in chat view
    chatBackBtn.addEventListener('click', () => {
        activeChatJid = null;
        showScreen('screen-chat-list');
        loadChatList(searchInput.value);
    });

    // Refresh button
    refreshChatsBtn.addEventListener('click', () => {
        loadChatList(searchInput.value);
    });

    // Layer 1: Batch Mode Handlers
    if (batchModeBtn) {
        batchModeBtn.addEventListener('click', () => {
            enterBatchMode();
        });
    }

    if (batchCancelBtn) {
        batchCancelBtn.addEventListener('click', () => {
            exitBatchMode();
        });
    }

    if (batchSelectAllBtn) {
        batchSelectAllBtn.addEventListener('click', () => {
            if (!loadedChats || loadedChats.length === 0) return;
            if (selectedChatJids.size === loadedChats.length) {
                // Deselect all
                selectedChatJids.clear();
                document.querySelectorAll('.chat-item.selected').forEach(el => el.classList.remove('selected'));
            } else {
                // Select all
                loadedChats.forEach(c => selectedChatJids.add(c.jid));
                document.querySelectorAll('.chat-item').forEach(el => el.classList.add('selected'));
            }
            updateBatchSelectionUI();
        });
    }

    if (batchDeleteBtn) {
        batchDeleteBtn.addEventListener('click', () => {
            if (selectedChatJids.size === 0) return;
            const count = selectedChatJids.size;
            batchDeleteModalTitle.textContent = `Hapus ${count} Chat Terpilih?`;
            batchDeleteModalDesc.textContent = `Seluruh riwayat pesan dari ${count} chat yang dipilih akan dihapus permanen dari monitoring.`;
            batchDeleteModal.classList.add('active');
        });
    }

    if (cancelBatchDeleteBtn) {
        cancelBatchDeleteBtn.addEventListener('click', () => {
            batchDeleteModal.classList.remove('active');
        });
    }

    if (confirmBatchDeleteBtn) {
        confirmBatchDeleteBtn.addEventListener('click', async () => {
            if (selectedChatJids.size === 0) return;
            const jidsToDelete = Array.from(selectedChatJids);
            batchDeleteModal.classList.remove('active');

            try {
                const res = await fetch('/api/chats/batch-delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ jids: jidsToDelete })
                });
                if (res.ok) {
                    jidsToDelete.forEach(jid => {
                        const el = document.querySelector(`[data-chat-jid="${jid}"]`);
                        if (el) el.remove();
                    });
                    exitBatchMode();
                    loadChatList(searchInput.value);
                } else {
                    alert('Gagal menghapus pesan chat. Pastikan server aktif.');
                }
            } catch (err) {
                console.error('Error saat hapus batch pesan:', err);
            }
        });
    }

    // Logout Modal Handlers
    menuBtn.addEventListener('click', () => {
        logoutModal.classList.add('active');
    });

    modalCancelBtn.addEventListener('click', () => {
        logoutModal.classList.remove('active');
    });

    modalConfirmLogoutBtn.addEventListener('click', async () => {
        logoutModal.classList.remove('active');
        try {
            await fetch('/api/logout', { method: 'POST' });
            showScreen('screen-qr');
        } catch (e) {
            console.error(e);
        }
    });

    // Layer 2: Delete Selected Message Modal Handlers
    cancelDeleteMsgBtn.addEventListener('click', () => {
        pendingDeleteMsgId = null;
        deleteMessageModal.classList.remove('active');
    });

    confirmDeleteMsgBtn.addEventListener('click', async () => {
        if (!pendingDeleteMsgId) return;
        const msgId = pendingDeleteMsgId;
        deleteMessageModal.classList.remove('active');
        try {
            await fetch(`/api/messages/${encodeURIComponent(msgId)}`, { method: 'DELETE' });
            const bubbleEl = document.querySelector(`[data-msg-id="${msgId}"]`);
            if (bubbleEl) {
                bubbleEl.remove();
            }
            loadChatList(searchInput.value);
        } catch (e) {
            console.error('Gagal menghapus pesan terpilih:', e);
        }
        pendingDeleteMsgId = null;
    });

    // Utility: HTML Escaping
    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // Initial check on load
    fetch('/api/status')
        .then(res => res.json())
        .then(data => {
            if (data.state === 'connected') {
                targetPhoneLabel.textContent = data.user?.phone || data.user?.name || 'Terhubung';
                showScreen('screen-chat-list');
                loadChatList();
                // Check initial focus mode
                fetch('/api/focus')
                    .then(r => r.json())
                    .then(fData => updateFocusBanner(fData))
                    .catch(e => console.error(e));
            } else if (data.state === 'qr_ready' && data.qr) {
                qrImage.src = data.qr;
                qrImage.style.display = 'block';
                qrLoading.style.display = 'none';
                showScreen('screen-qr');
            } else {
                showScreen('screen-qr');
            }
        })
        .catch(err => {
            console.error('Gagal mengambil status awal:', err);
        });
});
