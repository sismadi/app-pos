// ============================================================
// pages/transaksi.js — Transaksi jual (ke customer) & beli (dari
// supplier), pola header+baris sama seperti distribusi.js — header dibuat
// dulu (Lokasi + Kontak lewat lokasiKontakFields() bersama), baris
// produknya ditambah lewat katalog+keranjang BERSAMA (pages/shared.js),
// komponen yang sama dipakai kasir & distribusi supaya konsisten dan
// bisa tambah banyak produk sekaligus. Perbedaan dgn distribusi:
// (1) finalisasi jual MENGURANGI stok lokasi, beli MENAMBAH — kebalikan
//     dari distribusi masuk/keluar tapi logikanya identik;
// (2) transaksi jual bisa dibayar QRIS -> membuat 1 baris di tabel
//     `payment` (lihat qrisPage.buatPembayaran).
// ============================================================
web.routes.transaksi = 'resolveTransaksi';

// --- Katalog+keranjang untuk menambah baris produk (reuse dari shared.js) ---
const transaksiCatalogPage = createCatalogCart('transaksiCatalogPage', {
    cartTitle: 'Tambah Baris Produk',
    allowPriceEdit: true,
    getPrice: (p) => transaksiCatalogPage._tipe === 'jual' ? (p.hargaJual || 0) : (p.hargaBeli || 0),
    getStock: (p) => transaksiCatalogPage._stokMap?.[p.id] ?? null,
    emptyCatalogMsg: 'Belum ada produk aktif.',
    emptyCartMsg: 'Belum ada produk dipilih. Ketuk produk di atas untuk menambah baris.',
    confirmLabel: (ctrl) => `Tambahkan ${ctrl.jumlahItem()} Baris Produk`,
    onConfirm: async (cart, form, ctrl) => {
        const transaksiId = ctrl._transaksiId;
        for (const c of cart) {
            await db.insert('transaksi_produk', {
                transaksiId, produkId: c.produkId, qty: c.qty, hargaSatuan: c.harga, subtotal: c.qty * c.harga,
            });
        }
        await transaksiPage._syncTotal(transaksiId);
        web.closeDrawer();
        web.navigate(`transaksi/detail-${transaksiId}`);
    },
});

const transaksiPage = {
    async bukaTambah(tipe) {
        const [lokasiList, kontakList] = await Promise.all([
            db.query('lokasi', () => true),
            db.query('kontak', k => tipe === 'jual' ? k.tipe === 'customer' : (k.tipe === 'supplier' || k.tipe === 'distributor')),
        ]);
        if (!lokasiList.length) return alert('Buat lokasi terlebih dahulu di menu Lokasi.');

        web.openDrawer({
            title: tipe === 'jual' ? 'Transaksi Jual Baru' : 'Transaksi Beli Baru',
            fields: [
                { type: 'hidden', name: 'tipe', value: tipe },
                { type: 'text',   name: 'nomor', label: 'Nomor', placeholder: 'Opsional, otomatis jika kosong' },
                { type: 'text',   name: 'tanggal', label: 'Tanggal', value: new Date().toISOString().slice(0, 10) },
                ...lokasiKontakFields(lokasiList, kontakList, {
                    kontakLabel: tipe === 'jual' ? 'Customer (opsional)' : 'Supplier',
                }),
                { type: 'select', name: 'metodePembayaran', label: 'Metode Pembayaran', value: 'tunai',
                  options: [{ value: 'tunai', label: 'Tunai' }, { value: 'qris', label: 'QRIS' }] },
                { type: 'textarea', name: 'catatan', label: 'Catatan' },
            ],
            submitText: 'Simpan sebagai Draft',
            onSubmit: 'event.preventDefault(); transaksiPage.simpanHeader(this);',
            lines: ['form:', '**Catatan:** tambahkan baris produk setelah dokumen dibuat, lalu Finalisasi.'],
        });
    },

    async simpanHeader(form) {
        const val = (n) => form.querySelector(`[name="${n}"]`)?.value;
        const data = {
            tipe: val('tipe'), nomor: val('nomor') || ('TR-' + Date.now().toString(36).toUpperCase()),
            tanggal: val('tanggal') || new Date().toISOString().slice(0, 10),
            lokasiId: val('lokasiId'), kontakId: val('kontakId') || null,
            status: 'draft', metodePembayaran: val('metodePembayaran') || 'tunai',
            totalBayar: 0, catatan: val('catatan') || '',
        };
        if (!data.lokasiId) return alert('Lokasi wajib dipilih.');

        try { await db.insert('transaksi', { ...data, createdAt: new Date().toISOString() }); }
        catch (err) { return alert('Gagal menyimpan: ' + err.message); }

        web.closeDrawer();
        web.navigate('transaksi');
    },

    /** Tambah baris produk lewat katalog+keranjang bersama (bisa banyak
     *  produk sekaligus) — sama seperti kasir, konsisten & reuse. */
    async bukaTambahBaris(transaksiId, tipe) {
        const [produkList, trx] = await Promise.all([
            db.query('produk', p => p.aktif),
            db.find('transaksi', t => t.id === transaksiId),
        ]);
        if (!produkList.length) return alert('Belum ada produk aktif.');
        const stokRows = trx ? await db.query('lokasi_produk', s => s.lokasiId === trx.lokasiId) : [];
        transaksiCatalogPage._transaksiId = transaksiId;
        transaksiCatalogPage._tipe = tipe;
        transaksiCatalogPage._stokMap = Object.fromEntries(stokRows.map(s => [s.produkId, s.stok]));
        transaksiCatalogPage.kataKunci = '';
        transaksiCatalogPage.kategoriAktif = '';
        transaksiCatalogPage.setProdukList(produkList);
        transaksiCatalogPage.openPicker(`Tambah Baris — Transaksi ${tipe === 'jual' ? 'Jual' : 'Beli'}`);
    },

    async hapusBaris(id, transaksiId) {
        if (!confirm('Hapus baris ini?')) return;
        try {
            await db.remove('transaksi_produk', id);
            await this._syncTotal(transaksiId);
        } catch (err) { return alert('Gagal menghapus: ' + err.message); }
        web.navigate(`transaksi/detail-${transaksiId}`);
    },

    async _syncTotal(transaksiId) {
        const baris = await db.query('transaksi_produk', b => b.transaksiId === transaksiId);
        const total = baris.reduce((sum, b) => sum + (b.qty * b.hargaSatuan), 0);
        await db.update('transaksi', transaksiId, { totalBayar: total });
    },

    /**
     * Finalisasi: status draft -> selesai + stok lokasi disesuaikan
     * (jual mengurangi, beli menambah) + kalau metode QRIS, buat 1 baris
     * pembayaran (tabel `payment`) berstatus pending.
     */
    async finalisasi(transaksiId) {
        if (!confirm('Finalisasi transaksi ini? Stok akan langsung disesuaikan.')) return;

        const trx = await db.find('transaksi', t => t.id === transaksiId);
        if (!trx) return alert('Transaksi tidak ditemukan.');
        if (trx.status !== 'draft') return alert('Transaksi ini sudah difinalisasi/dibatalkan sebelumnya.');

        const baris = await db.query('transaksi_produk', b => b.transaksiId === transaksiId);
        if (!baris.length) return alert('Tambahkan minimal 1 baris produk sebelum difinalisasi.');

        try {
            for (const b of baris) {
                const existing = await db.find('lokasi_produk', s => s.lokasiId === trx.lokasiId && s.produkId === b.produkId);
                const stokLama = existing?.stok || 0;
                const delta = trx.tipe === 'jual' ? -b.qty : b.qty;
                const stokBaru = stokLama + delta;
                if (existing) await db.update('lokasi_produk', existing.id, { stok: stokBaru });
                else await db.insert('lokasi_produk', { lokasiId: trx.lokasiId, produkId: b.produkId, stok: stokBaru, stokMinimum: 0 });
            }
            await db.update('transaksi', transaksiId, { status: 'selesai' });

            if (trx.metodePembayaran === 'qris') {
                await qrisPage.buatPembayaran(transaksiId, trx.totalBayar);
            }
        } catch (err) { return alert('Gagal memfinalisasi: ' + err.message); }

        alert('Transaksi berhasil difinalisasi.');
        web.navigate(`transaksi/detail-${transaksiId}`);
    },

    async batalkan(transaksiId) {
        if (!confirm('Batalkan dokumen draft ini?')) return;
        try { await db.update('transaksi', transaksiId, { status: 'batal' }); }
        catch (err) { return alert('Gagal membatalkan: ' + err.message); }
        web.navigate(`transaksi/detail-${transaksiId}`);
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
        try { await db.update('payment', paymentId, { status: 'lunas', paidAt: new Date().toISOString() }); }
        catch (err) { return alert('Gagal memperbarui status: ' + err.message); }
        web.navigate(`transaksi/detail-${transaksiId}`);
    },
};

async function resolveTransaksi(sub) {
    const guard = requireLogin(['owner', 'kasir']);
    if (guard) return guard;

    if (sub && sub.startsWith('detail-')) return resolveTransaksiDetail(sub.replace('detail-', ''));

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
                `<button class="slcBtn" onclick="transaksiPage.bukaTambah('jual')">+ Transaksi Jual</button>
                 <button class="slcBtn" style="background:#555" onclick="transaksiPage.bukaTambah('beli')">+ Transaksi Beli</button>`,
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
        Aksi: trx.status === 'draft'
            ? `<button class="slcBtn" style="background:#c0392b" onclick="transaksiPage.hapusBaris('${b.id}','${id}')">Hapus</button>`
            : '-',
    }));

    const aksiHeader = trx.status === 'draft'
        ? `<button class="slcBtn" onclick="transaksiPage.bukaTambahBaris('${id}','${trx.tipe}')">+ Tambah Baris Produk</button>
           <button class="slcBtn" style="background:#1e824c" onclick="transaksiPage.finalisasi('${id}')">Finalisasi</button>
           <button class="slcBtn" style="background:#c0392b" onclick="transaksiPage.batalkan('${id}')">Batalkan</button>`
        : `<button class="slcBtn" style="background:#555" onclick="web.navigate('transaksi')">&larr; Kembali</button>`;

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
                aksiHeader,
                `table:${JSON.stringify(tableRows)}`,
                ...paymentBlock,
            ],
            emptyText: 'Belum ada baris produk pada transaksi ini.',
        },
    ];
}
