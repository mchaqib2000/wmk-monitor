# WMK - WhatsApp Monitor (HP ke HP) 📱🔒

Aplikasi monitor WhatsApp khusus untuk pemantauan pribadi / anak (*parental monitoring*) dan alternatif pencadangan (*backup*) data percakapan secara langsung tanpa memerlukan sinkronisasi email atau Google Drive.

---

## 🌟 Fitur Utama WMK

1. **Taut Barcode WhatsApp (Multi-Device Protocol)**
   - Menggunakan protokol resmi *WhatsApp Linked Devices*.
   - Cukup scan barcode sekali dari WhatsApp di HP target (Anak), aplikasi akan otomatis tersambung secara *real-time*.
2. **Read-Only (Hanya Baca)**
   - Tidak ada kolom pengetikan teks, tombol kirim, atau fungsi balas pesan.
   - 100% aman dan dirancang murni untuk monitoring/backup data.
3. **Tampilan Kontak & Preview 1 Baris**
   - Menampilkan **Nama Kontak** (atau nama yang tersimpan).
   - Menampilkan **Nomor WhatsApp Lengkap** (`+62 ...`).
   - Menampilkan **Isi Pesan Terakhir 1 Baris** (*single line truncated*) agar daftar percakapan terlihat rapi dan ringkas.
4. **Tampilan Chat Sederhana**
   - Tampilan gelembung percakapan (*chat bubble*) yang bersih dan ringan.
   - Dilengkapi waktu pengiriman (*timestamp*) dan status pesan.
5. **Anti-Delete: Pesan Terhapus Tetap Terbaca + Dot Merah (🔴)**
   - Apabila pengirim pesan menarik/menghapus pesan untuk semua orang (*Delete for Everyone*), pesan aslinya **TIDAK HILANG** di WMK.
   - Ditandai dengan keterangan:
     `🔴 Pesan ini telah dihapus oleh pengirim`
   - Pada daftar chat utama, kontak yang memiliki pesan terhapus juga ditandai dengan lencana merah (`🔴 X terhapus`).

---

## 📂 Struktur Proyek

```text
Whatsapp Monitoring for kids/
├── server/
│   ├── index.js          # REST API & Socket.IO server (Port 3000)
│   ├── db.js             # SQLite database (Penyimpan chat & anti-delete)
│   └── whatsapp.js       # Engine Baileys (Barcode & event interceptor)
├── public/
│   ├── index.html        # Antarmuka aplikasi mobile WMK
│   ├── app.js            # Logika realtime (Socket.IO, anti-delete handler)
│   ├── style.css         # Desain WhatsApp Android modern & responsif
│   ├── manifest.json     # Konfigurasi PWA (WebAPK Android)
│   ├── sw.js             # Service Worker
│   └── icons/
│       └── icon.svg      # Logo resmi aplikasi WMK
├── android-apk-source/   # Source code lengkap Android Studio (Native Wrapper)
│   ├── app/
│   │   ├── build.gradle
│   │   └── src/main/
│   │       ├── AndroidManifest.xml
│   │       └── java/com/wmk/monitor/MainActivity.java
│   └── build.gradle
├── package.json          # Modul dependensi (Node.js)
├── start.bat             # 1-Klik launcher untuk Windows
└── README.md             # Panduan lengkap
```

---

## 🚀 Panduan Menjalankan & Memasang WMK

### LANGKAH 1: Menjalankan Server WMK

Server bertindak sebagai mesin penerima data WhatsApp dan database lokal.

#### Opsi A: Jalankan di Komputer / Laptop (Satu Jaringan WiFi)
1. Pastikan **Node.js** sudah terpasang di komputer Anda.
2. Klik dua kali file **`start.bat`** (atau jalankan di terminal: `node server/index.js`).
3. Terminal akan menampilkan alamat IP lokal, contoh:
   ```text
   - Akses Lokal PC       : http://localhost:3000
   - Akses HP Android/WiFi : http://192.168.1.100:3000
   ```

#### Opsi B: Jalankan 100% di HP Android (Tanpa PC via Termux)
Jika ingin server berjalan terus di HP tanpa laptop:
1. Pasang aplikasi **Termux** di HP dari F-Droid.
2. Di Termux, jalankan:
   ```bash
   pkg update && pkg install nodejs git
   cd /path/ke/folder/wmk
   npm install
   node server/index.js
   ```

---

### LANGKAH 2: Memasang Aplikasi ke HP Android (Menjadi APK)

Anda memiliki 2 cara mudah untuk menjadikan WMK sebagai aplikasi di HP Android:

#### Cara 1 (Paling Cepat & Direkomendasikan: PWA / WebAPK)
Aplikasi WMK sudah dilengkapi teknologi **Progressive Web App (PWA)** standar Android:
1. Di HP Anda (HP Orang Tua / Monitor), buka browser Chrome dan masuk ke alamat server (misal: `http://192.168.1.100:3000`).
2. Browser akan memunculkan banner hijau di atas: **"📲 Pasang WMK ke layar utama HP"**.
3. Ketuk tombol **Pasang** (atau ketuk titik tiga di pojok kanan atas Chrome > pilih **"Instal aplikasi"** / **"Tambahkan ke Layar Utama"**).
4. Selesai! Ikon aplikasi **WMK** akan muncul di menu aplikasi & layar depan HP seperti aplikasi Android APK pada umumnya. Saat dibuka, aplikasi akan berjalan layar penuh (*fullscreen*) tanpa bilah URL browser.

#### Cara 2: Build Native APK dengan Android Studio
Folder `android-apk-source/` telah disediakan jika Anda ingin mengompilasi file `.apk` asli:
1. Buka folder `android-apk-source` menggunakan **Android Studio**.
2. Hubungkan HP Android atau pilih menu **Build > Build Bundle(s) / APK(s) > Build APK(s)**.
3. Pasang file `.apk` hasil kompilasi ke HP Anda.
4. Saat pertama kali dibuka, masukkan alamat IP server WMK Anda.

---

### LANGKAH 3: Menautkan Barcode ke HP Target (Anak)

1. Buka aplikasi **WMK** di HP Anda.
2. Layar akan menampilkan barcode WhatsApp dan instruksi.
3. Ambil HP target (Anak):
   - Buka aplikasi **WhatsApp**.
   - Ketuk menu **Titik Tiga** di kanan atas (Android) atau **Pengaturan** (iPhone).
   - Pilih **Perangkat Tertaut** (*Linked Devices*).
   - Ketuk **Tautkan Perangkat** (*Link a Device*).
   - Arahkan kamera HP target ke barcode di layar aplikasi WMK.
4. Setelah terhubung:
   - Barcode akan otomatis hilang dan berganti ke tampilan **Daftar Chat**.
   - Semua pesan yang masuk dan keluar otomatis tercatat dan tersimpan rapi di database lokal HP/komputer Anda.
   - Jika ada pesan yang ditarik oleh pengirim di WhatsApp asli, aplikasi WMK akan tetap menampilkannya beserta tanda titik merah 🔴.
