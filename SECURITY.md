# Keamanan & Performa `pos-app`

Dokumen ini merangkum temuan pada versi awal frontend (semua nilai
dirender lewat template string ke `innerHTML` tanpa escaping apa pun) dan
perbaikan yang diterapkan pada versi saat ini, ditulis dengan referensi
langsung ke pola yang sudah diterapkan di `piawai-app`.

## Temuan KRITIS pada versi sebelumnya (sudah diperbaiki)

1. **Tidak ada escaping HTML sama sekali.** `components.renderTable()` dan
   `components.genericForm()` merender nilai apa pun (nama produk, nama
   kontak, alamat, kategori, keterangan jurnal, nama akun, dst — semuanya
   bisa diisi bebas lewat form) langsung ke `innerHTML` tanpa diproses.
   Mengisi field seperti nama produk dengan `<img src=x onerror=alert(1)>`
   akan DIEKSEKUSI sebagai HTML setiap kali daftar produk dibuka — stored
   XSS di hampir setiap halaman CRUD (produk, kontak, lokasi, akun, jurnal)
   dan di katalog/keranjang layar kasir (`pages/shared.js`).
   → **Diperbaiki:** `escHtml()` terpusat di `engine.js`; `renderTable()` &
   `genericForm()` meng-escape nilai SECARA DEFAULT. Kolom yang memang
   sengaja berisi HTML mentah (badge status, tombol Aksi) harus didaftarkan
   eksplisit lewat `opts.rawKeys` — opt-out, bukan opt-in.
2. **`user.name` & `user.tenantNama` dirender mentah** di header (chip akun,
   lihat `auth.renderAuthUI()`) dan di Dashboard (`Selamat datang kembali,
   ...`). Kedua nilai ini bisa diisi bebas saat REGISTRASI MANDIRI (tanpa
   moderasi) dan tampil di HAMPIR SETIAP HALAMAN setelah login — titik XSS
   paling "produktif" di aplikasi ini karena sekali tersimpan, tereksekusi
   terus-menerus tanpa perlu korban membuka halaman tertentu.
   → **Diperbaiki:** `escHtml(user.name)` / `escHtml(user.tenantNama)` di
   `auth.renderAuthUI()` dan `dashboard.js`.
3. **Id dalam atribut `onclick` disisipkan lewat interpolasi string manual**
   (`onclick="produkPage.hapus('${p.id}')"`) di seluruh halaman CRUD. Id
   yang dihasilkan server relatif aman, tapi pola ini rapuh terhadap tanda
   kutip apa pun yang lolos — dan nilai LAIN yang dipakai dengan pola sama
   (nama kategori produk di filter chip katalog, `pages/shared.js`) memang
   input pengguna bebas.
   → **Diperbaiki:** `JSON.stringify(id)` dipakai di semua `onclick`
   dinamis (atribut memakai kutip tunggal `onclick='...'` supaya kutip
   ganda hasil `JSON.stringify` tidak memutus atribut), konsisten dengan
   pola di `piawai-app`.

## Perubahan performa (mengikuti pola `piawai-app`)

- **Loading skrip halaman paralel** (`dataset.js`, `loadPageScripts`) —
  sebelumnya berurutan (satu `<script>` baru disisipkan setelah yang
  sebelumnya `onload`), sekarang `Promise.all` setelah `shared.js`
  (satu-satunya dependensi urutan nyata) selesai dimuat.
- **Render pertama tidak menunggu event `load` penuh** — dipicu manual
  setelah skrip halaman siap.
- **Guard anti race-condition navigasi** (`web._navSeq` di `engine.js`) —
  klik cepat antar-halaman tidak lagi "kedip" balik ke halaman sebelumnya.
- **Cache in-memory per tabel** (`db.js`, TTL 30 detik) — dibuang otomatis
  tiap ada insert/update/remove, jadi tidak pernah menampilkan data basi
  setelah CRUD milik pengguna sendiri.
- **Progress bar navigasi** (`#navProgress`, murni kosmetik) — jeda saat
  fetch data terasa "sedang memuat" alih-alih diam/kedip.

## Audit "semua form dalam drawer"

Diverifikasi: SEMUA form tambah/edit di aplikasi ini (produk, kontak,
lokasi + atur stok, distribusi, transaksi, tenant, akun, jurnal manual)
dibuka lewat `web.openDrawer()` — tidak ada form CRUD di luar drawer.
Form Jurnal Manual (`jurnalPage.bukaForm()`) merakit markup manual lewat
`bodyHtml` (karena butuh tabel baris debit/kredit dinamis), tapi TETAP
dibuka lewat `web.openDrawer()` — bukan pengecualian dari pola drawer,
hanya isi drawer-nya yang tidak lewat `genericForm()` generik.

Halaman kasir/transaksi/distribusi (layar "katalog + keranjang") BUKAN
form dalam pengertian CRUD sederhana — itu adalah layar transaksional
penuh (grid produk + keranjang), dan keranjangnya sendiri tetap tampil
dalam drawer (`ctrl.openCart()`/`ctrl.openPicker()`, lihat `pages/shared.js`)
saat dipisah dari area katalog.
