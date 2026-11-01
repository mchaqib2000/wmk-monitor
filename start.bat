@echo off
title WMK - WhatsApp Monitor (Read-Only)
color 0A
echo ========================================================
echo        WMK - WhatsApp Monitor (HP ke HP)
echo    Fitur: Scan Barcode, Read-Only, Anti-Delete (Dot Merah)
echo ========================================================
echo.

node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js belum terinstall di komputer ini!
    echo Silakan download dan install Node.js dari https://nodejs.org
    pause
    exit /b
)

if not exist node_modules (
    echo Mengunduh paket modul yang dibutuhkan...
    call npm install
)

:loop
echo Menjalankan WMK Server...
echo Buka browser di komputer: http://localhost:3000
echo Atau buka dari HP Android: cek IP yang muncul di bawah
echo.
node server/index.js
echo.
echo ========================================================
echo Server terhenti. Memulai ulang otomatis dalam 2 detik...
echo (Tutup jendela ini jika ingin mematikan server)
echo ========================================================
timeout /t 2 /nobreak >nul
cls
goto loop
