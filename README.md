# POS Multi-Tenant

Konversi dari aplikasi MOOC (Cloudflare Worker + D1 + SPA vanilla JS) menjadi
aplikasi kasir (POS) multi-toko. Arsitektur & pola kode (Worker CRUD generik,
mesin render `components`/`ui.render`, drawer form geser-kanan) dipertahankan
dari sumber aslinya — yang diganti adalah skema data dan halaman bisnisnya.

## Struktur Proyek

```
pos-api/
  schema.sql     -> skema D1 (tenants, users, produk, lokasi, lokasi_produk,
                     kontak, distribusi(+_produk), transaksi(+_produk), payment)
  worker.js      -> Worker API generik + penegakan isolasi tenant
  wrangler.toml  -> konfigurasi deploy Cloudflare Worker + D1

pos-app/
  style.css, svg.css, svg.js  -> aset UI, disalin apa adanya dari sumber
  engine.js      -> mesin render generik (routing, drawer, components)
  db.js          -> lapisan data async + auto tenant-scoping
  auth.js        -> login (Kode Toko + username/password), registrasi mandiri
  dataset.js     -> konfigurasi menu (siteConfig) + daftar file halaman
  index.html     -> markup dasar + urutan pemuatan skrip
  pages/
    home.js        -> landing page publik
    produk.js       -> CRUD produk (pola CRUD dasar)
    kontak.js       -> CRUD kontak (distributor/supplier/customer/lainnya)
    lokasi.js       -> CRUD lokasi (toko/gudang) + kelola stok per lokasi
    distribusi.js   -> mutasi stok masuk/keluar + finalisasi stok
    transaksi.js    -> transaksi jual/beli + finalisasi stok + pembayaran QRIS
    tenant.js       -> kelola daftar tenant (khusus superadmin)
    dashboard.js    -> ringkasan KPI + produk terlaris
```

## Model Data Multi-Tenant

Semua tabel bisnis (kecuali `tenants`) punya kolom `tenantId`. Satu tenant =
satu toko. Login memakai **Kode Toko** (kolom `tenants.kodeToko`) + username +
password — dengan begini satu username bisa dipakai ulang di toko yang
berbeda tanpa bentrok, karena pencarian akun selalu dipersempit ke tenant
yang kode tokonya cocok terlebih dahulu.

Superadmin adalah tenant khusus (`kodeToko = SUPERADMIN`, sudah di-seed di
`schema.sql`) yang hanya mengelola daftar tenant lain (halaman **Kelola
Tenant**) — bukan tenant bisnis sungguhan.

Akun demo (dari seed `schema.sql`):

| Kode Toko  | Username     | Password    | Peran      |
|------------|--------------|-------------|------------|
| TOKO001    | owner        | owner123    | Pemilik    |
| TOKO001    | kasir        | kasir123    | Kasir      |
| SUPERADMIN | superadmin   | super123    | Superadmin |

## Alur Bisnis Inti

- **Produk & Kontak** — CRUD sederhana (pola dasar dipakai ulang di semua halaman lain).
- **Lokasi** — CRUD toko/gudang; tiap lokasi punya baris stok sendiri di `lokasi_produk`.
- **Distribusi** (masuk/keluar) & **Transaksi** (jual/beli) memakai pola
  *header + baris produk*, dan berstatus `draft` dulu. Stok di `lokasi_produk`
  **baru berubah saat dokumen difinalisasi** (tombol "Finalisasi") — supaya
  dokumen masih bisa dikoreksi sebelum stok benar-benar bergerak.
- **Payment (QRIS)** — saat transaksi jual dengan metode QRIS difinalisasi,
  dibuat 1 baris di tabel `payment` berstatus `pending`. Tombol "Tandai
  Lunas (Simulasi)" menggantikan webhook gateway pembayaran sungguhan.

## Menjalankan

```bash
# 1) Buat & isi database D1
cd pos-api
wrangler d1 create pos_multi_tenant     # salin database_id hasilnya ke wrangler.toml
wrangler d1 execute pos_multi_tenant --file=./schema.sql
wrangler deploy

# 2) Sajikan pos-app/ sebagai static site (mis. Cloudflare Pages) dengan
#    proxy /api/* ke Worker di atas (atau jalankan `wrangler pages dev` bila
#    Worker & Pages digabung 1 project).
```

## Catatan Penting — Ini Level Demo, Bukan Siap Produksi

1. **Isolasi tenant di `worker.js` masih berbasis input klien.** `tenantId`
   dikirim lewat query string (`?tenantId=...`) dan diverifikasi terhadap isi
   baris di database, tapi TIDAK diverifikasi lewat token sesi tervalidasi
   server-side. Ini cukup mencegah kebocoran data antar-tenant akibat *bug*
   di frontend, tapi seorang pengguna yang sengaja mengubah `tenantId` lewat
   devtools/URL berpotensi mengakses data tenant lain kalau ia sudah tahu
   `tenantId` tenant tersebut. **Untuk produksi sungguhan**, ganti dengan
   JWT/sesi yang diterbitkan & diverifikasi di Worker saat login, lalu ambil
   `tenantId` dari token tersebut (bukan dari input klien) di setiap request.
2. **Password tersimpan plaintext** di kolom `users.password` (sama seperti
   kode sumber MOOC aslinya). Wajib diganti dengan hashing (mis. bcrypt/
   scrypt via Worker) sebelum dipakai dengan data pengguna sungguhan.
3. **Kode QRIS bersifat simulasi** (`qrString` hanya string demo, bukan kode
   QRIS valid) dan "Tandai Lunas" adalah tombol manual menggantikan webhook.
   Untuk produksi, integrasikan dengan payment gateway QRIS resmi (mis.
   Midtrans, Xendit, atau langsung ke penyelenggara QRIS) yang akan
   mengonfirmasi status pembayaran lewat webhook ke Worker.
4. Belum ada validasi lanjutan seperti pencegahan stok negatif saat
   finalisasi transaksi jual (stok bisa jadi minus jika stok tidak
   mencukupi) — pertimbangkan menambah pengecekan ini sebelum dipakai nyata.
