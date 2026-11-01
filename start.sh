#!/bin/bash
# Menjaga proses tetap hidup saat layar HP mati
termux-wake-lock 2>/dev/null || true

echo "========================================================"
echo "   WMK - WhatsApp Monitor (Read-Only & Anti-Delete)   "
echo "========================================================"
echo "Server berjalan di HP Anda."
echo "Buka Google Chrome di HP ini: http://localhost:3000"
echo "--------------------------------------------------------"

node --experimental-sqlite server/index.js 2>/dev/null || node server/index.js
