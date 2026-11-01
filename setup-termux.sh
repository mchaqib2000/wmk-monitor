#!/bin/bash
# WMK - WhatsApp Monitor Installer Otomatis untuk Android (Termux)
# Menjalankan Server & Aplikasi 100% langsung di dalam HP tanpa Komputer!

echo "========================================================"
echo "    Menginstall WMK - WhatsApp Monitor di HP Android    "
echo "========================================================"

# Mencegah HP menidurkan proses saat layar mati
termux-wake-lock 2>/dev/null || true

# 1. Update paket Termux
echo "[1/4] Memperbarui repositori Termux..."
pkg update -y && pkg upgrade -y

# 2. Install Node.js dan dependensi compiler
echo "[2/4] Menginstall Node.js, Python, Git & Compiler..."
pkg install -y nodejs git python make clang pkg-config

# 3. Masuk ke direktori dan install modul
echo "[3/4] Mengunduh modul dependensi WhatsApp..."
export CFLAGS="-I$PREFIX/include/node"
export CXXFLAGS="-I$PREFIX/include/node"
npm install
npm rebuild better-sqlite3 --build-from-source 2>/dev/null || true

# 4. Berikan izin eksekusi script start
chmod +x start.sh 2>/dev/null || true

echo "========================================================"
echo "          INSTALASI SELESAI DENGAN SUKSES!              "
echo "========================================================"
echo "Untuk menjalankan WMK kapan saja di HP Anda, ketik:"
echo "  ./start.sh"
echo ""
echo "Lalu buka Google Chrome di HP: http://localhost:3000"
echo "========================================================"

# Jalankan langsung
bash start.sh
