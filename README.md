# CIKOPS Fleet OS

Sistem manajemen tugas driver — kelanjutan dari sistem lama berbasis Google Apps Script + Google Sheets, dibangun ulang dengan stack modern:

- **Frontend**: Next.js 14 (App Router), di-deploy ke **Vercel**
- **Database**: **Supabase** (Postgres) menggantikan Google Sheets
- **Realtime**: Supabase Realtime — dashboard & driver panel update otomatis tanpa refresh

Dua halaman utama:

| Halaman | Path | Fungsi |
|---|---|---|
| Driver Panel | `/driver` | Login PIN, lihat tugas hari ini, terima/selesaikan tugas, riwayat, ganti PIN |
| Dashboard Admin | `/dashboard` | Monitoring semua tugas real-time, form penugasan driver baru |

---

## 1. Setup Supabase

1. Buat project baru di [supabase.com](https://supabase.com) (gratis untuk mulai).
2. Buka **SQL Editor** → **New query**.
3. Copy seluruh isi file `supabase/schema.sql` dari project ini, paste, lalu **Run**.
   - Ini akan membuat semua tabel (`drivers`, `vehicles`, `employees`, `job_types`, `tasks`), view `tasks_detail`, RPC functions untuk autentikasi PIN dan transisi status tugas, RLS policies, mengaktifkan Realtime pada tabel `tasks`, dan mengisi beberapa data contoh (3 driver, 3 kendaraan, 3 pegawai).
   - **Semua driver contoh memiliki PIN default `1234`** — ganti melalui halaman Profil di driver panel, atau langsung di database.
4. Ambil kredensial API: **Project Settings** → **API**.
   - Catat **Project URL** dan **anon public key** — keduanya dibutuhkan di langkah berikutnya.

### Jika kamu sudah pernah setup database ini sebelumnya (upgrade)

Sudah punya project Supabase yang sudah pernah dijalankan `schema.sql` versi lama? Cukup jalankan file `supabase/migration_cancel_job.sql` satu kali di SQL Editor — ini menambahkan status **CANCELLED** dan fungsi pembatalan tugas tanpa menghapus data yang sudah ada. Aman dijalankan berkali-kali. Setup baru tidak perlu menjalankan ini karena sudah termasuk di `schema.sql`.

### Menambah/mengubah data driver, kendaraan, pegawai

Bisa langsung lewat **Table Editor** di Supabase Dashboard, atau lewat SQL:

```sql
insert into drivers (nama, no_hp, avatar_emoji) values ('Nama Driver', '0812xxxx', '🧑‍✈️');
insert into vehicles (nopol, jenis) values ('B 1111 AAA', 'Toyota Avanza');
insert into employees (nik, nama, departement) values ('010', 'Nama Pegawai', 'Operations');
```

PIN default untuk driver baru otomatis `1234` (lihat default `pin_hash` di schema). Driver bisa menggantinya sendiri lewat tab **Profil** di driver panel.

---

## 2. Setup project secara lokal (opsional, untuk testing sebelum deploy)

```bash
npm install
cp .env.example .env.local
# isi .env.local dengan Project URL & anon key dari Supabase
npm run dev
```

Buka `http://localhost:3000` — otomatis redirect ke `/driver`. Akses dashboard di `http://localhost:3000/dashboard`.

---

## 3. Deploy ke Vercel

### Opsi A — lewat Vercel Dashboard (paling mudah)

1. Push folder project ini ke repository GitHub/GitLab/Bitbucket.
2. Buka [vercel.com/new](https://vercel.com/new), import repository tersebut.
3. Vercel otomatis mendeteksi Next.js — tidak perlu ubah build settings.
4. Di bagian **Environment Variables**, tambahkan:
   - `NEXT_PUBLIC_SUPABASE_URL` → Project URL dari Supabase
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` → anon public key dari Supabase
5. Klik **Deploy**.

### Opsi B — lewat Vercel CLI

```bash
npm install -g vercel
vercel login
vercel
# ikuti prompt, lalu set environment variables:
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY
vercel --prod
```

Setelah deploy, aplikasi akan tersedia di `https://nama-project.vercel.app/driver` dan `/dashboard`.

---

## 4. Struktur project

```
cikops-fleet/
├── supabase/
│   └── schema.sql          ← jalankan sekali di Supabase SQL Editor
├── src/
│   ├── lib/
│   │   ├── supabaseClient.ts   ← koneksi Supabase
│   │   ├── types.ts             ← TypeScript types
│   │   └── api.ts               ← semua query & RPC call (dipakai driver + dashboard)
│   └── app/
│       ├── layout.tsx           ← root layout (metadata, PWA)
│       ├── globals.css          ← design tokens (warna, font, dark/light theme)
│       ├── page.tsx             ← redirect ke /driver
│       ├── driver/
│       │   ├── page.tsx             ← Driver Panel (landing, PIN, app)
│       │   └── driver.module.css    ← styling Driver Panel
│       └── dashboard/
│           ├── page.tsx                ← Dashboard Admin (monitoring + form)
│           └── dashboard.module.css    ← styling Dashboard
├── public/
│   ├── manifest.json         ← PWA manifest
│   ├── icon-192.png           ← placeholder, ganti dengan logo asli
│   └── icon-512.png           ← placeholder, ganti dengan logo asli
├── package.json
├── tsconfig.json
└── next.config.js
```

---

## 5. Cara kerja autentikasi driver

Tidak memakai Supabase Auth — sesuai keputusan desain, login driver memakai PIN 4 digit yang disimpan di kolom `pin_hash` (bcrypt) pada tabel `drivers`. Alurnya:

1. Driver memilih namanya di halaman landing (`/driver`).
2. Memasukkan PIN 4 digit lewat numpad.
3. Frontend memanggil RPC `verify_driver_pin(driver_id, pin)` di Supabase — **PIN di-hash dan dicocokkan di sisi database**, tidak pernah dikirim sebagai plaintext untuk dibandingkan di client, dan `pin_hash` tidak pernah ter-expose ke browser.
4. Jika cocok, RPC mengembalikan data driver (tanpa `pin_hash`) dan driver masuk ke halaman utama.

Ganti PIN dilakukan lewat RPC `set_driver_pin`, juga divalidasi di sisi database.

Sesi login driver disimpan di `localStorage` (key `cikops_driver_session`) sehingga refresh halaman tidak memaksa login ulang. Sesi baru hilang saat driver menekan tombol **Keluar** secara eksplisit.

---

## 6. Cara kerja realtime & standby

Tabel `tasks` didaftarkan ke `supabase_realtime` publication (sudah otomatis lewat `schema.sql`). Baik Driver Panel maupun Dashboard subscribe ke channel Postgres Changes pada tabel ini (`src/lib/api.ts` → `subscribeToTasks`). Setiap insert/update/delete pada `tasks` (misalnya admin baru saja menugaskan driver) memicu re-fetch otomatis di kedua halaman tanpa perlu reload manual.

Agar driver yang sedang login tetap "standby" menerima tugas baru meski HP sempat masuk mode hemat daya/koneksi putus sebentar, Driver Panel menambahkan beberapa jaring pengaman di atas realtime: refresh paksa + resubscribe saat tab/app kembali terlihat (`visibilitychange`) atau saat koneksi internet kembali (`online`), serta polling cadangan ringan setiap 45 detik selama halaman aktif terlihat.

### Notifikasi tugas baru (getar + suara)

Saat ada tugas baru berstatus ASSIGNED yang sebelumnya belum pernah dilihat driver, panel akan otomatis bergetar (`navigator.vibrate`, hanya berfungsi di browser mobile yang mendukung) dan membunyikan dua nada pendek lewat Web Audio API (tidak memerlukan file audio eksternal). Notifikasi hanya terpicu untuk tugas yang benar-benar baru, bukan untuk perubahan status biasa.

---

## 7. Fitur Cancel Job

Driver dapat membatalkan tugas miliknya sendiri (status ASSIGNED atau ON GOING) lewat tombol **Batalkan Tugas** di kartu tugas — divalidasi di sisi database lewat RPC `cancel_task` sehingga tidak bisa membatalkan tugas driver lain. Admin di Dashboard juga dapat membatalkan tugas siapa pun lewat tombol **Batalkan** di tabel/kartu tugas. Tugas yang dibatalkan berstatus `CANCELLED` dan tetap tersimpan di riwayat (tidak dihapus), lengkap dengan informasi siapa yang membatalkan (`cancelled_by`: `driver` atau `admin`) dan kapan (`cancelled_at`).

---

## 8. Dashboard adaptif (desktop vs mobile)

Dashboard mendeteksi lebar viewport (`useIsMobile` hook, breakpoint 860px) dan merender presentasi yang berbeda dari data yang sama: tabel lebar dengan scroll horizontal di desktop, kartu vertikal yang lebih mudah dibaca dengan jari di mobile. Form penugasan dan modal lainnya sudah responsive di kedua ukuran.

---

## 9. Laporan (Report PDF & CSV)

Tombol ikon 📄 di topbar Dashboard membuka modal untuk memilih rentang tanggal, lalu mengunduh:

- **CSV** — data mentah lengkap setiap tugas pada rentang tanggal tersebut (tanggal, driver, kendaraan, status, semua timestamp, alasan batal jika ada), siap diolah lebih lanjut di Excel/Google Sheets. Disertai BOM UTF-8 agar karakter Indonesia tidak rusak saat dibuka di Excel.
- **PDF** — laporan komprehensif dua bagian: ringkasan keseluruhan (total/baru/berjalan/selesai/dibatalkan) plus ringkasan performa per driver (total tugas, tingkat penyelesaian, durasi rata-rata pengerjaan) di halaman pertama, lalu tabel detail lengkap setiap tugas di halaman berikutnya. Dibuat sepenuhnya di browser (client-side, library `jspdf` + `jspdf-autotable`) tanpa perlu server tambahan.

---

## 10. Catatan keamanan & pengembangan lanjutan

- Saat ini RLS (Row Level Security) dibuka cukup permisif karena tidak ada sistem login admin terpisah — siapa pun yang memegang `anon key` bisa membuat/mengubah tugas. Untuk produksi yang lebih ketat, pertimbangkan menambahkan Supabase Auth khusus untuk halaman `/dashboard` (login admin), dan membatasi policy `tasks_insert_all` / `tasks_update_all` hanya untuk role yang terautentikasi.
- Transisi status tugas oleh **driver** (`ASSIGNED → ON GOING → DONE → CANCELLED`) dikunci lewat RPC `accept_task` / `complete_task` / `cancel_task` sehingga tidak bisa di-skip atau dipalsukan dari client.
- Fitur email laporan otomatis dari sistem GAS lama **belum diporting** ke versi ini (PDF/CSV sekarang sudah bisa diunduh manual dari Dashboard) — beri tahu jika ingin ditambahkan pengiriman email terjadwal sebagai langkah selanjutnya.
- Ikon PWA (`public/icon-192.png`, `icon-512.png`) sudah menggunakan logo CIKOPS asli (`public/logo.svg`) — ganti file SVG ini jika ingin memperbarui identitas visual.
