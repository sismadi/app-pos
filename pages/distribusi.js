// ============================================================
// pages/distribusi.js — Distribusi stok masuk (dari supplier) & keluar
// (mutasi lokasi), lewat mesin BERSAMA createInstantDocumentPage (pages/
// shared.js) — mesin yang SAMA PERSIS dipakai kasir.js & transaksi.js:
// pilih Lokasi/Kontak di atas -> ketuk produk di katalog -> satu tombol
// konfirmasi langsung membuat header + baris produk + penyesuaian stok
// (masuk menambah, keluar mengurangi) sekali jalan, tanpa status draft
// manual — meniru layar kasir sungguhan untuk KETIGA alur (kasir,
// transaksi, distribusi), bukan cuma katalognya doang yang di-share.
// ============================================================
web.routes.distribusi = 'resolveDistribusi';

const distribusiKasirPage = createInstantDocumentPage('distribusiKasirPage', {
    headerTable: 'distribusi', lineTable: 'distribusi_produk', headerIdField: 'distribusiId',
    nomorPrefix: () => 'DIST-',
    detailRoute: () => 'distribusi/detail-',
    pageTitle: (tipe) => tipe === 'masuk' ? 'Distribusi Masuk' : 'Distribusi Keluar',
    pageDesc: (tipe) => tipe === 'masuk'
        ? 'Pilih lokasi tujuan & supplier di atas, ketuk produk untuk menambah ke keranjang, lalu ketuk tombol keranjang di kanan-bawah untuk selesai.'
        : 'Pilih lokasi asal & kontak di atas, ketuk produk untuk menambah ke keranjang, lalu ketuk tombol keranjang di kanan-bawah untuk selesai.',
    lokasiLabel: (tipe) => tipe === 'masuk' ? 'Lokasi Tujuan' : 'Lokasi Asal',
    kontakLabel: (tipe) => tipe === 'masuk' ? 'Supplier/Distributor' : 'Kontak',
    kontakEmptyLabel: (tipe) => tipe === 'masuk' ? 'tanpa supplier' : 'tanpa kontak',
    kontakFilter: (k, tipe) => tipe === 'masuk' ? (k.tipe === 'supplier' || k.tipe === 'distributor') : true,
    getPrice: (p, tipe) => tipe === 'masuk' ? (p.hargaBeli || 0) : (p.hargaJual || 0),
    allowPriceEdit: true,
    cartTitle: 'Keranjang',
    emptyCatalogMsg: 'Belum ada produk aktif.',
    emptyCartMsg: 'Keranjang masih kosong. Ketuk produk di katalog untuk menambah.',
    confirmLabel: (ctrl) => `Selesaikan (${ctrl.jumlahItem()} item)`,
    stockDelta: (tipe) => tipe === 'masuk' ? 1 : -1,
    // distribusi/distribusi_produk tidak punya kolom metodePembayaran/totalBayar/subtotal
    // (lihat schema.sql) — jadi headerExtra & lineExtra sengaja tidak dipakai di sini.
});

const distribusiPage = {
    async hapus(id) {
        if (!confirm('Hapus dokumen distribusi ini? Stok TIDAK dikembalikan otomatis — sesuaikan manual bila perlu.')) return;
        try { await db.remove('distribusi', id); } catch (err) { return alert('Gagal menghapus: ' + err.message); }
        web.navigate('distribusi');
    },
};

async function resolveDistribusi(sub) {
    const guard = requireLogin(['owner', 'gudang']);
    if (guard) return guard;

    if (sub && sub.startsWith('detail-')) return resolveDistribusiDetail(sub.replace('detail-', ''));

    if (sub === 'masuk' || sub === 'keluar') {
        await distribusiKasirPage.load(sub);
        distribusiKasirPage.kataKunci = '';
        distribusiKasirPage.kategoriAktif = '';

        const judul = sub === 'masuk' ? 'Distribusi Masuk' : 'Distribusi Keluar';
        if (!distribusiKasirPage.lokasiList.length) {
            return [
                { section: 'titleHero', title: judul, description: 'Mutasi stok lewat layar kasir.' },
                { section: 'articleFull', subtitle: 'Belum Bisa Distribusi', lines: ['Buat minimal 1 lokasi di menu Lokasi sebelum membuat dokumen distribusi.'] },
            ];
        }
        if (!distribusiKasirPage.produkList.length) {
            return [
                { section: 'titleHero', title: judul, description: 'Mutasi stok lewat layar kasir.' },
                { section: 'articleFull', subtitle: 'Belum Ada Produk', lines: ['Tambahkan produk aktif di menu Produk sebelum membuat dokumen distribusi.'] },
            ];
        }
        return distribusiKasirPage.pageBlocks(sub);
    }

    const [rows, lokasiList, kontakList] = await Promise.all([
        db.query('distribusi', () => true),
        db.query('lokasi', () => true),
        db.query('kontak', () => true),
    ]);
    const lokasiById = Object.fromEntries(lokasiList.map(l => [l.id, l]));
    const kontakById = Object.fromEntries(kontakList.map(k => [k.id, k]));

    const tableRows = rows
        .sort((a, b) => (b.tanggal || '').localeCompare(a.tanggal || ''))
        .map(d => ({
            Nomor: d.nomor,
            Tipe: `<span class="badge ${d.tipe === 'masuk' ? '' : 'badge-warning'}">${d.tipe === 'masuk' ? 'Masuk' : 'Keluar'}</span>`,
            Tanggal: d.tanggal,
            Lokasi: lokasiById[d.lokasiId]?.nama || '-',
            Kontak: kontakById[d.kontakId]?.nama || '-',
            Status: d.status === 'selesai' ? '<span class="badge badge-success">Selesai</span>' : '<span class="badge badge-muted">Draft</span>',
            Aksi: `<button class="slcBtn" onclick="web.navigate('distribusi/detail-${d.id}')">Lihat</button>`,
        }));

    return [
        { section: 'titleHero', title: 'Distribusi', description: 'Mutasi stok masuk (dari supplier) dan keluar (antar lokasi).' },
        {
            section: 'articleFull',
            subtitle: `Daftar Distribusi (${rows.length})`,
            lines: [
                `<button class="slcBtn" onclick="web.navigate('distribusi/masuk')">+ Distribusi Masuk</button>
                 <button class="slcBtn" style="background:#555" onclick="web.navigate('distribusi/keluar')">+ Distribusi Keluar</button>`,
                `table:${JSON.stringify(tableRows)}`,
            ],
            emptyText: 'Belum ada dokumen distribusi.',
        },
    ];
}

async function resolveDistribusiDetail(id) {
    const dok = await db.find('distribusi', d => d.id === id);
    if (!dok) return [{ section: 'titleHero', title: 'Dokumen Tidak Ditemukan' }];

    const [baris, lokasi, kontak, produkList] = await Promise.all([
        db.query('distribusi_produk', b => b.distribusiId === id),
        db.find('lokasi', l => l.id === dok.lokasiId),
        dok.kontakId ? db.find('kontak', k => k.id === dok.kontakId) : Promise.resolve(null),
        db.query('produk', () => true),
    ]);
    const produkById = Object.fromEntries(produkList.map(p => [p.id, p]));

    const tableRows = baris.map(b => ({
        Produk: produkById[b.produkId]?.nama || '(produk terhapus)',
        Jumlah: b.qty,
        'Harga Satuan': formatRupiah(b.hargaSatuan),
        Subtotal: formatRupiah(b.qty * b.hargaSatuan),
    }));

    return [
        { section: 'titleHero', title: `Distribusi ${dok.tipe === 'masuk' ? 'Masuk' : 'Keluar'} — ${dok.nomor}`,
          description: `Lokasi: <strong>${lokasi?.nama || '-'}</strong> &middot; Kontak: <strong>${kontak?.nama || '-'}</strong> &middot; Status: <strong>${dok.status === 'selesai' ? 'Selesai' : 'Draft'}</strong>` },
        {
            section: 'articleFull',
            subtitle: `Baris Produk (${baris.length})`,
            lines: [
                `<button class="slcBtn" style="background:#555" onclick="web.navigate('distribusi')">&larr; Kembali</button>
                 <button class="slcBtn" style="background:#c0392b" onclick="distribusiPage.hapus('${id}')">Hapus</button>`,
                `table:${JSON.stringify(tableRows)}`,
            ],
            emptyText: 'Belum ada baris produk pada dokumen ini.',
        },
    ];
}
