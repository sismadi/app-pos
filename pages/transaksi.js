// ============================================================
// pages/transaksi.js — Transaksi jual (ke customer) & beli (dari
// supplier), lewat mesin BERSAMA createInstantDocumentPage (pages/
// shared.js) — mesin yang SAMA PERSIS dipakai kasir.js & distribusi.js:
// pilih Lokasi/Kontak di atas -> ketuk produk di katalog -> satu tombol
// konfirmasi langsung membuat header + baris produk + penyesuaian stok
// (jual mengurangi, beli menambah) sekali jalan, tanpa status draft
// manual — meniru layar kasir sungguhan untuk KETIGA alur (kasir,
// transaksi, distribusi), bukan cuma katalognya doang yang di-share.
// Kalau metode QRIS, langsung dibuat 1 baris di tabel `payment`
// (lihat qrisPage.buatPembayaran).
// ============================================================
web.routes.transaksi = 'resolveTransaksi';

const transaksiKasirPage = createInstantDocumentPage('transaksiKasirPage', {
    headerTable: 'transaksi', lineTable: 'transaksi_produk', headerIdField: 'transaksiId',
    nomorPrefix: () => 'TR-',
    detailRoute: () => 'transaksi/detail-',
    pageTitle: (tipe) => tipe === 'jual' ? 'Transaksi Jual' : 'Transaksi Beli',
    pageDesc: (tipe) => tipe === 'jual'
        ? 'Pilih lokasi & customer di atas, ketuk produk untuk menambah ke keranjang, lalu ketuk tombol keranjang di kanan-bawah untuk selesai.'
        : 'Pilih lokasi & supplier di atas, ketuk produk untuk menambah ke keranjang, lalu ketuk tombol keranjang di kanan-bawah untuk selesai.',
    lokasiLabel: () => 'Lokasi',
    kontakLabel: (tipe) => tipe === 'jual' ? 'Customer' : 'Supplier',
    kontakEmptyLabel: (tipe) => tipe === 'jual' ? 'umum / tanpa nama' : 'tanpa supplier',
    kontakFilter: (k, tipe) => tipe === 'jual' ? k.tipe === 'customer' : (k.tipe === 'supplier' || k.tipe === 'distributor'),
    getPrice: (p, tipe) => tipe === 'jual' ? (p.hargaJual || 0) : (p.hargaBeli || 0),
    allowPriceEdit: true,
    cartTitle: 'Keranjang',
    emptyCatalogMsg: 'Belum ada produk aktif.',
    emptyCartMsg: 'Keranjang masih kosong. Ketuk produk di katalog untuk menambah.',
    extraFieldsHtml: () => `
        <div class="a-row"><label class="a-label">Bayar dengan</label>
            <select name="metodePembayaran">
                <option value="tunai">Tunai</option>
                <option value="qris">QRIS</option>
            </select></div>`,
    readExtra: (form) => ({ metodePembayaran: form.querySelector('[name="metodePembayaran"]')?.value || 'tunai' }),
    headerExtra: (ctrl, extra) => ({ metodePembayaran: extra.metodePembayaran, totalBayar: ctrl.total() }),
    lineExtra: (c) => ({ subtotal: c.qty * c.harga }),
    confirmLabel: (ctrl) => `Selesaikan (${formatRupiah(ctrl.total())})`,
    stockDelta: (tipe) => tipe === 'jual' ? -1 : 1,
    afterConfirm: async (header, cart, tipe, ctrl) => {
        if (header.metodePembayaran === 'qris') await qrisPage.buatPembayaran(header.id, header.totalBayar);
        // Posting jurnal otomatis (Modul Keuangan) — lihat pages/jurnal.js.
        // Dilewati diam-diam kalau COA belum lengkap, transaksi tetap tersimpan.
        await jurnalPage.postingTransaksi(header, cart, ctrl);
    },
});

const transaksiPage = {
    async hapus(id) {
        if (!confirm('Hapus transaksi ini? Stok TIDAK dikembalikan otomatis — sesuaikan manual lewat Distribusi bila perlu.')) return;
        try { await db.remove('transaksi', id); } catch (err) { return alert('Gagal menghapus: ' + err.message); }
        web.navigate('transaksi');
    },
};

// --- Pembayaran QRIS ---------------------------------------------------
const qrisPage = {
    /** Buat 1 baris pembayaran QRIS. `qrString` di sini adalah DEMO (bukan
     *  kode QRIS asli/valid) — untuk produksi, ganti dengan hasil API
     *  gateway pembayaran QRIS sungguhan (mis. Midtrans, Xendit, dsb). */
    async buatPembayaran(transaksiId, jumlah) {
        const referensi = 'QRIS-' + Date.now().toString(36).toUpperCase();
        await db.insert('payment', {
            transaksiId, metode: 'qris', referensi,
            qrString: `DEMO-QRIS|ref=${referensi}|amount=${jumlah}`,
            jumlah, status: 'pending', createdAt: new Date().toISOString(), paidAt: null,
        });
    },

    /** Simulasi konfirmasi pembayaran (menggantikan webhook gateway sungguhan pada demo ini). */
    async tandaiLunas(paymentId, transaksiId) {
        if (!confirm('Tandai pembayaran ini sebagai LUNAS? (Pada aplikasi produksi, ini normalnya otomatis lewat webhook gateway QRIS.)')) return;
        try {
            const payment = await db.find('payment', p => p.id === paymentId);
            await db.update('payment', paymentId, { status: 'lunas', paidAt: new Date().toISOString() });
            // Reklasifikasi Piutang Usaha (QRIS) -> Kas di jurnal (Modul Keuangan).
            if (payment) await jurnalPage.postingPelunasanQris(payment);
        } catch (err) { return alert('Gagal memperbarui status: ' + err.message); }
        web.navigate(`transaksi/detail-${transaksiId}`);
    },
};

async function resolveTransaksi(sub) {
    const guard = requireLogin(['owner', 'kasir']);
    if (guard) return guard;

    if (sub && sub.startsWith('detail-')) return resolveTransaksiDetail(sub.replace('detail-', ''));

    if (sub === 'jual' || sub === 'beli') {
        await transaksiKasirPage.load(sub);
        transaksiKasirPage.kataKunci = '';
        transaksiKasirPage.kategoriAktif = '';

        const judul = sub === 'jual' ? 'Transaksi Jual' : 'Transaksi Beli';
        if (!transaksiKasirPage.lokasiList.length) {
            return [
                { section: 'titleHero', title: judul, description: 'Transaksi jual/beli lewat layar kasir.' },
                { section: 'articleFull', subtitle: 'Belum Bisa Transaksi', lines: ['Buat minimal 1 lokasi di menu Lokasi sebelum membuat transaksi.'] },
            ];
        }
        if (!transaksiKasirPage.produkList.length) {
            return [
                { section: 'titleHero', title: judul, description: 'Transaksi jual/beli lewat layar kasir.' },
                { section: 'articleFull', subtitle: 'Belum Ada Produk', lines: ['Tambahkan produk aktif di menu Produk sebelum membuat transaksi.'] },
            ];
        }
        return transaksiKasirPage.pageBlocks(sub);
    }

    const [rows, lokasiList, kontakList] = await Promise.all([
        db.query('transaksi', () => true),
        db.query('lokasi', () => true),
        db.query('kontak', () => true),
    ]);
    const lokasiById = Object.fromEntries(lokasiList.map(l => [l.id, l]));
    const kontakById = Object.fromEntries(kontakList.map(k => [k.id, k]));

    const statusBadge = { draft: 'badge-muted', selesai: 'badge-success', batal: 'badge-warning' };

    const tableRows = rows
        .sort((a, b) => (b.tanggal || '').localeCompare(a.tanggal || ''))
        .map(t => ({
            Nomor: t.nomor,
            Tipe: `<span class="badge ${t.tipe === 'jual' ? '' : 'badge-warning'}">${t.tipe === 'jual' ? 'Jual' : 'Beli'}</span>`,
            Tanggal: t.tanggal,
            Lokasi: lokasiById[t.lokasiId]?.nama || '-',
            Kontak: kontakById[t.kontakId]?.nama || '-',
            Total: formatRupiah(t.totalBayar),
            Status: `<span class="badge ${statusBadge[t.status] || ''}">${t.status}</span>`,
            Aksi: `<button class="slcBtn" onclick="web.navigate('transaksi/detail-${t.id}')">Lihat</button>`,
        }));

    return [
        { section: 'titleHero', title: 'Transaksi', description: 'Transaksi penjualan ke customer dan pembelian dari supplier.' },
        {
            section: 'articleFull',
            subtitle: `Daftar Transaksi (${rows.length})`,
            lines: [
                `<button class="slcBtn" onclick="web.navigate('transaksi/jual')">+ Transaksi Jual</button>
                 <button class="slcBtn" style="background:#555" onclick="web.navigate('transaksi/beli')">+ Transaksi Beli</button>`,
                `table:${JSON.stringify(tableRows)}`,
            ],
            emptyText: 'Belum ada transaksi.',
        },
    ];
}

async function resolveTransaksiDetail(id) {
    const trx = await db.find('transaksi', t => t.id === id);
    if (!trx) return [{ section: 'titleHero', title: 'Transaksi Tidak Ditemukan' }];

    const [baris, lokasi, kontak, produkList, payments] = await Promise.all([
        db.query('transaksi_produk', b => b.transaksiId === id),
        db.find('lokasi', l => l.id === trx.lokasiId),
        trx.kontakId ? db.find('kontak', k => k.id === trx.kontakId) : Promise.resolve(null),
        db.query('produk', () => true),
        db.query('payment', p => p.transaksiId === id),
    ]);
    const produkById = Object.fromEntries(produkList.map(p => [p.id, p]));

    const tableRows = baris.map(b => ({
        Produk: produkById[b.produkId]?.nama || '(produk terhapus)',
        Jumlah: b.qty,
        'Harga Satuan': formatRupiah(b.hargaSatuan),
        Subtotal: formatRupiah(b.qty * b.hargaSatuan),
    }));

    const pay = payments[0];
    const paymentBlock = pay ? [
        '## Pembayaran QRIS',
        `card:Status Pembayaran:${pay.status === 'lunas' ? 'LUNAS' : 'Menunggu Pembayaran'}`,
        `card:Jumlah:${formatRupiah(pay.jumlah)}`,
        `card:Referensi:${pay.referensi}`,
        pay.status === 'pending'
            ? `<div class="info-card"><strong>Kode QRIS (Demo)</strong><p style="word-break:break-all">${pay.qrString}</p>
               <button class="slcBtn" onclick="qrisPage.tandaiLunas('${pay.id}','${id}')">Tandai Lunas (Simulasi)</button></div>`
            : '',
    ] : [];

    return [
        { section: 'titleHero', title: `Transaksi ${trx.tipe === 'jual' ? 'Jual' : 'Beli'} — ${trx.nomor}`,
          description: `Lokasi: <strong>${lokasi?.nama || '-'}</strong> &middot; Kontak: <strong>${kontak?.nama || '-'}</strong> &middot; Status: <strong>${trx.status}</strong> &middot; Metode: <strong>${trx.metodePembayaran.toUpperCase()}</strong>` },
        {
            section: 'articleFull',
            subtitle: `Baris Produk (${baris.length}) — Total: ${formatRupiah(trx.totalBayar)}`,
            lines: [
                `<button class="slcBtn" style="background:#555" onclick="web.navigate('transaksi')">&larr; Kembali</button>
                 <button class="slcBtn" style="background:#c0392b" onclick="transaksiPage.hapus('${id}')">Hapus</button>`,
                `table:${JSON.stringify(tableRows)}`,
                ...paymentBlock,
            ],
            emptyText: 'Belum ada baris produk pada transaksi ini.',
        },
    ];
}
