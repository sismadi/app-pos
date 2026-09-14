// ============================================================
// pages/home.js — Landing page publik, statis (tidak butuh login/DB).
// ============================================================
pages.home = [
    {
        section: 'hero',
        title: 'Sistem Kasir (POS) Multi-Toko',
        tagline: 'Satu aplikasi, banyak toko',
        description: 'Kelola produk, stok, distribusi, dan transaksi jual-beli dari satu tempat — data tiap toko terpisah aman satu sama lain.',
        badges: ['Multi-Tenant', 'Stok Multi-Lokasi', 'Pembayaran QRIS'],
        imgClass: 'di-cart',
        cta: { text: 'Daftarkan Toko Anda', link: 'register' },
    },
    {
        section: 'features',
        items: [
            { icon: 'di-cart',   title: 'Transaksi Jual & Beli', content: 'Catat penjualan ke pelanggan dan pembelian dari supplier, lengkap dengan rincian per produk.' },
            { icon: 'di-geo',    title: 'Stok Multi-Lokasi',     content: 'Pantau stok tiap produk secara terpisah di setiap toko/gudang milik Anda.' },
            { icon: 'di-scan',   title: 'Distribusi Stok',       content: 'Catat mutasi stok masuk (dari supplier) dan keluar (antar lokasi) dengan rapi.' },
            { icon: 'di-jabat',  title: 'Kontak Terpusat',       content: 'Simpan data distributor, supplier, dan pelanggan dalam satu daftar kontak.' },
            { icon: 'di-qrcode', title: 'Pembayaran QRIS',       content: 'Terima pembayaran non-tunai lewat QRIS langsung dari halaman transaksi.' },
            { icon: 'di-chart',  title: 'Dashboard Ringkas',     content: 'Lihat ringkasan penjualan dan stok menipis dalam satu halaman.' },
        ],
    },
    {
        section: 'articleFull',
        subtitle: 'Mulai Sekarang',
        lines: [
            'Setiap toko yang mendaftar mendapat ruang data sendiri (multi-tenant) — data Anda tidak akan tercampur dengan toko lain.',
            'link:Daftarkan Toko Baru:register',
            '---',
            'link:Sudah punya akun? Masuk di sini:login',
        ],
    },
];
