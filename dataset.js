// ============================================================
// dataset.js — Konfigurasi menu (siteConfig). Urutan & label menu
// cukup diatur di SATU tempat ini (dipakai oleh renderMenu() di
// index.html) — menambah halaman baru tidak perlu menyentuh index.html.
//
// Field per item:
//   slug      -> dicocokkan dengan web.navigate('slug') / web.routes
//   label     -> teks yang tampil di menu
//   menu      -> true supaya muncul di navbar (halaman tanpa menu:true
//                tetap bisa diakses lewat link langsung, mis. 'login')
//   guestOnly -> true = hanya tampil kalau BELUM login (mis. 'login')
//   role      -> array peran yang boleh melihat menu ini; kosong = semua
//                peran yang sudah login boleh lihat (owner/kasir/gudang)
// ============================================================
const siteConfig = [
    { slug: 'home',        label: 'Beranda',  menu: true },
    { slug: 'dashboard',   label: 'Dashboard', menu: true, role: ['owner', 'kasir', 'gudang'] },
    { slug: 'kasir',       label: 'Kasir',     menu: true, role: ['owner', 'kasir'] },
    { slug: 'transaksi',   label: 'Transaksi', menu: true, role: ['owner', 'kasir'] },
    { slug: 'produk',      label: 'Produk',    menu: true, role: ['owner', 'gudang'] },
    { slug: 'lokasi',      label: 'Lokasi',    menu: true, role: ['owner', 'gudang'] },
    { slug: 'distribusi',  label: 'Distribusi', menu: true, role: ['owner', 'gudang'] },
    { slug: 'kontak',      label: 'Kontak',    menu: true, role: ['owner', 'kasir', 'gudang'] },
    { slug: 'tenant',      label: 'Kelola Tenant', menu: true, role: ['superadmin'] },
    { slug: 'login',       label: 'Masuk',     menu: true, guestOnly: true },
];

// `pages` diisi oleh pages/home.js (halaman publik statis). Halaman bisnis
// (produk, kontak, dst.) TIDAK memakai objek `pages` ini — mereka
// mengambil data langsung dari db.js tiap kali dibuka (lihat pages/*.js).
const pages = {};

// Daftar file JS halaman yang dimuat berurutan sebelum menu dirender.
const pageFiles = [
    'pages/_shared.js',
    'pages/home.js',
    'pages/produk.js',
    'pages/kontak.js',
    'pages/lokasi.js',
    'pages/distribusi.js',
    'pages/transaksi.js',
    'pages/kasir.js',
    'pages/tenant.js',
    'pages/dashboard.js',
];

function loadPageScripts(files, done) {
    let i = 0;
    (function next() {
        if (i >= files.length) { done(); return; }
        const s = document.createElement('script');
        s.src = files[i++];
        s.onload = next;
        s.onerror = next; // tetap lanjut walau 1 file gagal, supaya halaman lain tidak ikut macet
        document.body.appendChild(s);
    })();
}
