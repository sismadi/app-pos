// ============================================================
// pages/dashboard.js — Ringkasan KPI + produk terlaris (statGrid + barChart,
// lihat engine.js). Superadmin diarahkan ke halaman Kelola Tenant, bukan
// dashboard toko (karena superadmin tidak memiliki data transaksi sendiri).
// [SECURITY] user.name & user.tenantNama BISA berasal dari input pengguna
// (diisi saat registrasi mandiri, lihat auth.js) — WAJIB escHtml() di sini
// karena titleHero.description dirender sebagai HTML mentah (sengaja,
// supaya tag <strong> tetap berfungsi). Item barChart (nama produk
// terlaris) sudah di-escape secara terpusat di dalam komponennya sendiri
// (lihat components.barChart di engine.js), tidak perlu diulang di sini.
// ============================================================
web.routes.dashboard = 'resolveDashboard';

async function resolveDashboard() {
    const guard = requireLogin(['owner', 'kasir', 'gudang', 'superadmin']);
    if (guard) return guard;

    const user = auth.currentUser();
    if (user.role === 'superadmin') return resolveTenant();

    const [transaksiList, produkList, lokasiList, stokList] = await Promise.all([
        db.query('transaksi', () => true),
        db.query('produk', () => true),
        db.query('lokasi', () => true),
        db.query('lokasi_produk', () => true),
    ]);

    const penjualanSelesai = transaksiList.filter(t => t.tipe === 'jual' && t.status === 'selesai');
    const totalPenjualan = penjualanSelesai.reduce((sum, t) => sum + (t.totalBayar || 0), 0);
    const transaksiDraft = transaksiList.filter(t => t.status === 'draft').length;
    const stokMenipis = stokList.filter(s => s.stok <= (s.stokMinimum || 0)).length;

    // Produk terlaris (berdasarkan total qty terjual pada transaksi jual yang selesai)
    const qtyPerProduk = {};
    for (const t of penjualanSelesai) {
        const baris = await db.query('transaksi_produk', b => b.transaksiId === t.id);
        for (const b of baris) qtyPerProduk[b.produkId] = (qtyPerProduk[b.produkId] || 0) + b.qty;
    }
    const produkById = Object.fromEntries(produkList.map(p => [p.id, p]));
    const terlaris = Object.entries(qtyPerProduk)
        .map(([produkId, qty]) => ({ label: produkById[produkId]?.nama || produkId, value: qty }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 5);

    // Laba bersih (Modul Keuangan) hanya dihitung & ditampilkan untuk owner —
    // pakai mesin yang sama dgn pages/laporan.js, tidak ada logika duplikat.
    const statLaba = [];
    if (user.role === 'owner' && typeof laporanPage !== 'undefined') {
        const saldoList = await laporanPage.hitungSaldoAkun();
        const pendapatan = saldoList.filter(s => s.akun.tipe === 'pendapatan').reduce((s, r) => s + r.saldoAkhir, 0);
        const beban = saldoList.filter(s => s.akun.tipe === 'beban').reduce((s, r) => s + r.saldoAkhir, 0);
        statLaba.push({ value: formatRupiah(pendapatan - beban), label: (pendapatan - beban) >= 0 ? 'Laba Bersih' : 'Rugi Bersih' });
    }

    return [
        { section: 'titleHero', title: 'Dashboard', description: `Selamat datang kembali, <strong>${escHtml(user.name)}</strong> &mdash; ${escHtml(user.tenantNama)}.` },
        {
            section: 'statGrid',
            stats: [
                { value: formatRupiah(totalPenjualan), label: 'Total Penjualan (Selesai)' },
                { value: penjualanSelesai.length, label: 'Transaksi Jual Selesai' },
                { value: transaksiDraft, label: 'Transaksi Draft (Belum Final)' },
                { value: produkList.length, label: 'Total Produk' },
                { value: lokasiList.length, label: 'Total Lokasi' },
                { value: stokMenipis, label: 'Baris Stok Menipis' },
                ...statLaba,
            ],
        },
        { section: 'barChart', title: 'Produk Terlaris (Jumlah Terjual)', items: terlaris },
        {
            section: 'article',
            leftCol: {
                subtitle: 'Aksi Cepat',
                lines: [
                    'link:+ Transaksi Baru:transaksi',
                    '---',
                    'link:Kelola Produk:produk',
                    '---',
                    'link:Kelola Lokasi & Stok:lokasi',
                    '---',
                    'link:Distribusi Stok:distribusi',
                    '---',
                    'link:Kontak:kontak',
                    // Modul Keuangan (akun/jurnal/laporan) hanya untuk owner — lihat dataset.js.
                    ...(user.role === 'owner' ? ['---', 'link:Laporan Keuangan:laporan'] : []),
                ],
            },
            rightCol: {
                subtitle: 'Peringatan Stok Menipis',
                lines: stokMenipis
                    ? [`card:Baris Stok Menipis:${stokMenipis} baris memerlukan perhatian`, 'link:Lihat Detail per Lokasi:lokasi']
                    : ['Tidak ada stok yang menipis saat ini. 👍'],
            },
        },
    ];
}
