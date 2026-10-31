// WMK - WhatsApp Monitor Client Application
document.addEventListener('DOMContentLoaded', () => {
    // State
    let currentScreen = 'screen-qr';
    let activeChatJid = null;
    let deferredPrompt = null;
    let searchTimeout = null;

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

    const installBanner = document.getElementById('install-banner');
    const installPwaBtn = document.getElementById('install-pwa-btn');

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
    });

    // Screen navigation helper
    function showScreen(screenId) {
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
        // If current chat is open, append message
        if (currentScreen === 'screen-chat-view' && activeChatJid === msg.chatJid) {
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
        chatListContainer.innerHTML = '';

        if (!chats || chats.length === 0) {
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

            const initials = getInitials(chat.name || chat.phone_number);
            const isGroup = chat.is_group === 1;
            const timeStr = formatTime(chat.last_message_time);
            const hasDeleted = chat.last_message_deleted === 1;
            const deletedCount = chat.deleted_messages_count || 0;

            // Single line preview formatting
            let previewText = chat.last_message || 'Belum ada pesan';
            if (hasDeleted) {
                previewText = `🔴 [Pesan Terhapus] ${chat.last_message}`;
            }

            item.innerHTML = `
                <div class="chat-avatar ${isGroup ? 'group' : ''}">${initials}</div>
                <div class="chat-info">
                    <div class="chat-top-row">
                        <span class="chat-name">${escapeHtml(chat.name || chat.phone_number)}</span>
                        <span class="chat-time">${timeStr}</span>
                    </div>
                    <div class="chat-phone">${escapeHtml(chat.phone_number || '')}</div>
                    <div class="chat-preview-row">
                        <span class="chat-preview ${hasDeleted ? 'has-deleted' : ''}">
                            ${escapeHtml(previewText)}
                        </span>
                        ${deletedCount > 0 ? `
                            <span class="deleted-badge" title="${deletedCount} pesan terhapus di chat ini">
                                <span class="dot-red"></span> ${deletedCount} terhapus
                            </span>
                        ` : ''}
                    </div>
                </div>
            `;

            item.addEventListener('click', () => {
                openChat(chat);
            });

            chatListContainer.appendChild(item);
        });
    }

    // Open Chat View (Requirement 4: tampilan chat sederhana)
    async function openChat(chat) {
        activeChatJid = chat.jid;

        // Set header details
        activeChatName.textContent = chat.name || chat.phone_number;
        activeChatPhone.textContent = chat.phone_number || '';
        activeChatAvatar.textContent = getInitials(chat.name || chat.phone_number);
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
        const bubble = document.createElement('div');
        bubble.className = `msg-bubble ${msg.from_me ? 'sent' : 'received'}`;
        bubble.setAttribute('data-msg-id', msg.id);

        const isDeleted = msg.is_deleted === 1;
        if (isDeleted) {
            bubble.classList.add('is-deleted');
        }

        const timeStr = formatTime(msg.timestamp);

        // Group sender name if received in group
        let senderHtml = '';
        if (!msg.from_me && msg.sender_name) {
            senderHtml = `<div class="msg-sender-name">${escapeHtml(msg.sender_name)}</div>`;
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

        bubble.innerHTML = `
            ${senderHtml}
            ${deletedBannerHtml}
            <div class="msg-text">${escapeHtml(msg.text)}</div>
            <div class="msg-meta">
                <span>${timeStr}</span>
                ${msg.from_me ? `
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#53BDEB" stroke-width="2">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                ` : ''}
            </div>
        `;

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
