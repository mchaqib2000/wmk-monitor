#!/bin/bash
# WMK - WhatsApp Monitor Installer Otomatis untuk Android (Termux)
# Menjalankan Server & Aplikasi 100% langsung di dalam HP tanpa Komputer!

echo "========================================================"
echo "    Menginstall WMK - WhatsApp Monitor di HP Android    "
echo "========================================================"

# 1. Update paket Termux
echo "[1/4] Memperbarui paket Termux..."
pkg update -y && pkg upgrade -y

# 2. Install Node.js dan dependensi sistem
echo "[2/4] Menginstall Node.js & Git..."
pkg install -y nodejs-lts git python make clang

# 3. Masuk ke direktori dan install modul
echo "[3/4] Mengunduh modul dependensi WhatsApp..."
npm install

# 4. Selesai dan petunjuk menjalankan
echo "========================================================"
echo "          INSTALASI SELESAI DENGAN SUKSES!              "
echo "========================================================"
echo "Untuk menjalankan WMK di HP kapan saja, ketik:"
echo "  node server/index.js"
echo ""
echo "Lalu buka Chrome di HP dan ketik: http://localhost:3000"
echo "========================================================"

# Jalankan langsung
echo "Menjalankan WMK sekarang..."
node server/index.js
