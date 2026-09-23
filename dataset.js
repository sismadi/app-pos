// ============================================================
// dataset.js — Konfigurasi menu (siteConfig). Urutan & label menu
// cukup diatur di SATU tempat ini (dipakai oleh renderMenu() di
// index.html) — menambah halaman baru tidak perlu menyentuh index.html.
//
// Item menu BIASA (link langsung), field:
//   slug      -> dicocokkan dengan web.navigate('slug') / web.routes
//   label     -> teks yang tampil di menu
//   menu      -> true supaya muncul di navbar (halaman tanpa menu:true
//                tetap bisa diakses lewat link langsung, mis. 'login')
//   guestOnly -> true = hanya tampil kalau BELUM login (mis. 'login')
//   role      -> array peran yang boleh melihat menu ini; kosong = semua
//                peran yang sudah login boleh lihat (owner/kasir/gudang)
//
// Item menu PARENT (dropdown berisi sub-menu), field:
//   label     -> teks parent yang tampil di navbar
//   menu      -> true supaya muncul di navbar
//   children  -> array item menu biasa (format sama seperti di atas,
//                tanpa field `menu`). Parent otomatis tersembunyi kalau
//                semua child-nya tersaring habis (guestOnly/role).
// ============================================================
const siteConfig = [
    { slug: 'home',        label: 'Beranda',  menu: true },
    { slug: 'dashboard',   label: 'Dashboard', menu: true, role: ['owner', 'kasir', 'gudang'] },
    {
        label: 'Penjualan',
        menu: true,
        children: [
            { slug: 'kasir',     label: 'Kasir',     role: ['owner', 'kasir'] },
            { slug: 'transaksi', label: 'Transaksi', role: ['owner', 'kasir'] },
        ],
    },
    {
        label: 'Data Master',
        menu: true,
        children: [
            { slug: 'produk',     label: 'Produk',     role: ['owner', 'gudang'] },
            { slug: 'lokasi',     label: 'Lokasi',     role: ['owner', 'gudang'] },
            { slug: 'distribusi', label: 'Distribusi', role: ['owner', 'gudang'] },
            { slug: 'kontak',     label: 'Kontak',     role: ['owner', 'kasir', 'gudang'] },
        ],
    },
    {
        label: 'Keuangan',
        menu: true,
        children: [
            { slug: 'akun',    label: 'Akun',    role: ['owner'] },
            { slug: 'jurnal',  label: 'Jurnal',  role: ['owner'] },
            { slug: 'laporan', label: 'Laporan Keuangan', role: ['owner'] },
        ],
    },
    { slug: 'tenant',      label: 'Kelola Tenant', menu: true, role: ['superadmin'] },
    { slug: 'login',       label: 'Masuk',     menu: true, guestOnly: true },
];

// `pages` diisi oleh pages/home.js (halaman publik statis). Halaman bisnis
// (produk, kontak, dst.) TIDAK memakai objek `pages` ini — mereka
// mengambil data langsung dari db.js tiap kali dibuka (lihat pages/*.js).
const pages = {};

// Daftar file JS halaman yang dimuat sebelum menu dirender.
const pageFiles = [
    'pages/shared.js',
    'pages/home.js',
    'pages/produk.js',
    'pages/kontak.js',
    'pages/lokasi.js',
    'pages/distribusi.js',
    'pages/transaksi.js',
    'pages/kasir.js',
    'pages/akun.js',
    'pages/jurnal.js',
    'pages/laporan.js',
    'pages/tenant.js',
    'pages/dashboard.js',
];

// [PERF] Dulu file-file ini dimuat BERURUTAN (satu <script> baru
// disisipkan setelah yang sebelumnya selesai onload) — waktu tunggu
// total = jumlah SEMUA file. Beberapa halaman (mis. distribusi.js/
// transaksi.js) saling bergantung pada `createInstantDocumentPage` dari
// shared.js, tapi TIDAK pada urutan satu sama lain — jadi cukup
// pastikan shared.js dimuat lebih dulu (lihat urutan pageFiles di atas),
// sisanya boleh paralel. Promise.all mengubah waktu tunggu jadi = waktu
// file TERLAMA saja, bukan jumlah semuanya.
function loadPageScripts(files, done) {
    const [first, ...rest] = files;
    const loadOne = (src) => new Promise((resolve) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = resolve; // tetap lanjut walau 1 file gagal, supaya halaman lain tidak ikut macet
        document.body.appendChild(s);
    });

    loadOne(first).then(() => Promise.all(rest.map(loadOne))).then(done);
}
