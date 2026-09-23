# POS Multi-Tenant

Aplikasi kasir (POS) multi-toko. Arsitektur & pola kode (mesin render
`components`/`ui.render`, drawer form geser-kanan, CRUD via Worker API)
mengikuti pola yang sama dengan `piawai-app` (CMS multi-user) — kedua
aplikasi berasal dari template yang sama, dan repo ini sudah melalui
pass hardening keamanan+performa yang sama. **Lihat `SECURITY.md` untuk
daftar lengkap temuan versi sebelumnya & perbaikan yang diterapkan.**

## Struktur Proyek

```
pos-api/
  schema.sql     -> skema D1 (tenants, users, produk, lokasi, lokasi_produk,
                     kontak, distribusi(+_produk), transaksi(+_produk),
                     payment, akun, jurnal(+_detail), rate_limit)
  worker.js      -> Worker API: auth server-side, RBAC per tabel, rate
                     limit + captcha, allowlist kolom tulis
  hash-password.mjs -> CLI untuk membuat hash password (seed/reset manual)
  wrangler.toml  -> konfigurasi deploy Cloudflare Worker + D1
  SECURITY.md    -> daftar temuan & perbaikan keamanan backend

pos-app/
  style.css, svg.css, svg.js  -> aset UI
  engine.js      -> mesin render generik (routing, drawer, components,
                     escaping HTML terpusat, progress bar navigasi)
  db.js          -> lapisan data async + token sesi + cache in-memory
  auth.js        -> login (Kode Toko + username/password) + captcha
                     matematika, registrasi mandiri
  dataset.js     -> konfigurasi menu (siteConfig) + loader skrip paralel
  index.html     -> markup dasar + urutan pemuatan skrip
  pages/
    home.js         -> landing page publik
    produk.js       -> CRUD produk (pola CRUD dasar, drawer)
    kontak.js       -> CRUD kontak (distributor/supplier/customer/lainnya)
    lokasi.js       -> CRUD lokasi (toko/gudang) + kelola stok per lokasi
    distribusi.js   -> mutasi stok masuk/keluar (layar kasir instan)
    transaksi.js    -> transaksi jual/beli (layar kasir instan) + QRIS
    kasir.js        -> alias tampilan cepat untuk transaksi jual
    shared.js       -> mesin katalog+keranjang & "layar kasir" bersama
    akun.js         -> CRUD Bagan Akun (Chart of Accounts) — Modul Keuangan
    jurnal.js       -> Jurnal Umum manual + posting otomatis — Modul Keuangan
    laporan.js      -> Neraca Saldo, Laba Rugi, Neraca, Perubahan Ekuitas
    tenant.js       -> kelola daftar tenant (khusus superadmin)
    dashboard.js    -> ringkasan KPI + produk terlaris
```

## Model Data Multi-Tenant

Semua tabel bisnis (kecuali `tenants`) punya kolom `tenantId`. Satu tenant =
satu toko. Login memakai **Kode Toko** (kolom `tenants.kodeToko`) + username +
password. `tenantId` **tidak pernah** dikirim/dipercaya dari klien — backend
menurunkannya dari token sesi HMAC yang diverifikasi server saat login
(lihat SECURITY.md temuan #2).

Superadmin adalah tenant khusus (`kodeToko = SUPERADMIN`, sudah di-seed di
`schema.sql`) yang hanya mengelola daftar tenant lain (halaman **Kelola
Tenant**) — bukan tenant bisnis sungguhan.

Akun demo (password di seed `schema.sql` adalah PLACEHOLDER — **wajib**
diganti lewat `hash-password.mjs` sebelum database dipakai, lihat bagian
Menjalankan di bawah):

| Kode Toko  | Username     | Peran      |
|------------|--------------|------------|
| TOKO001    | owner        | Pemilik    |
| TOKO001    | kasir        | Kasir      |
| SUPERADMIN | superadmin   | Superadmin |

## Alur Bisnis Inti

- **Produk & Kontak** — CRUD sederhana (pola dasar dipakai ulang di semua halaman lain).
- **Lokasi** — CRUD toko/gudang; tiap lokasi punya baris stok sendiri di `lokasi_produk`.
- **Distribusi** (masuk/keluar) & **Transaksi** (jual/beli) memakai layar
  kasir instan bersama (`pages/shared.js`): pilih lokasi/kontak -> ketuk
  produk -> satu tombol langsung membuat header + baris produk + penyesuaian
  stok sekali jalan (tanpa status draft manual terpisah).
- **Payment (QRIS)** — saat transaksi jual dengan metode QRIS diselesaikan,
  dibuat 1 baris di tabel `payment` berstatus `pending`. Tombol "Tandai
  Lunas (Simulasi)" menggantikan webhook gateway pembayaran sungguhan.

## Modul Keuangan (Akun, Jurnal, Neraca, Laba Rugi, Ekuitas)

Sengaja HANYA bisa diakses peran **owner** — ditegakkan di frontend
(`requireLogin(['owner'])`) DAN di backend (`WRITE_ROLES` di worker.js,
lihat SECURITY.md temuan #4) karena berisi data keuangan toko.

- **Akun (`akun`)** — Bagan Akun (Chart of Accounts).
- **Jurnal (`jurnal` + `jurnal_detail`)** — Jurnal Umum, baris debit/kredit
  wajib seimbang. Sumber: manual (tombol "+ Input Jurnal Manual") atau
  otomatis (hook `afterConfirm` di `createInstantDocumentPage`, dipanggil
  dari `kasir.js`/`transaksi.js` setiap transaksi jual/beli selesai).
- **Laporan (`laporan`)** — Neraca Saldo, Laba Rugi, Neraca, Perubahan
  Ekuitas, dihitung real-time dari `akun` + `jurnal_detail`.

## Menjalankan

```bash
# 1) Buat & isi database D1
cd pos-api
wrangler d1 create pos_multi_tenant     # salin database_id hasilnya ke wrangler.toml
wrangler d1 execute pos_multi_tenant --file=./schema.sql

# 2) WAJIB — set secret penandatangan sesi/captcha
wrangler secret put SESSION_SECRET      # isi dgn string acak, mis. `openssl rand -base64 32`

# 3) WAJIB — ganti hash password seed (placeholder di schema.sql BUKAN hash asli)
node hash-password.mjs "password-baru-anda"
wrangler d1 execute pos_multi_tenant --remote --command \
  "UPDATE users SET passwordHash='<hasil-di-atas>' WHERE id='usr_owner';"
# ulangi untuk usr_kasir & usr_super dengan password masing-masing

wrangler deploy

# 4) Sajikan pos-app/ sebagai static site (mis. Cloudflare Pages/GitHub
#    Pages) — GANTI API_BASE di db.js dan ALLOWED_ORIGINS di wrangler.toml
#    dengan URL hasil deploy masing-masing.
```

## Catatan yang Masih Berlaku (di luar cakupan hardening keamanan)

Poin-poin ini TIDAK berubah oleh pass hardening keamanan (lihat
SECURITY.md untuk yang sudah diperbaiki) — tetap perlu ditinjau sebelum
dipakai dengan uang/data sungguhan:

1. **Kode QRIS bersifat simulasi** (`qrString` hanya string demo, bukan kode
   QRIS valid) dan "Tandai Lunas" adalah tombol manual menggantikan webhook.
   Untuk produksi, integrasikan dengan payment gateway QRIS resmi (mis.
   Midtrans, Xendit) yang mengonfirmasi status lewat webhook ke Worker.
2. Belum ada pencegahan stok negatif saat transaksi jual (stok bisa jadi
   minus jika stok tidak mencukupi) — pertimbangkan menambah pengecekan ini.
3. **Modul Keuangan disederhanakan untuk demo**: (a) Distribusi masuk/keluar
   TIDAK diposting ke jurnal (dianggap mutasi stok internal); (b) tidak ada
   pajak/diskon di Laba Rugi; (c) tidak ada mekanisme tutup buku/periode
   akuntansi — untuk produksi, tambahkan proses tutup buku yang memindahkan
   saldo Laba Rugi ke akun Laba Ditahan tiap akhir periode.
