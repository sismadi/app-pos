// ============================================================
// pages/transaksi.js — Transaksi jual (ke customer) & beli (dari
// supplier), pola header+baris sama seperti distribusi.js. Perbedaan:
// (1) finalisasi jual MENGURANGI stok lokasi, beli MENAMBAH — kebalikan
//     dari distribusi masuk/keluar tapi logikanya identik;
// (2) transaksi jual bisa dibayar QRIS -> membuat 1 baris di tabel
//     `payment` (lihat qrisPage.buatPembayaran).
// ============================================================
web.routes.transaksi = 'resolveTransaksi';

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
                { type: 'select', name: 'lokasiId', label: 'Lokasi', required: true,
                  options: lokasiList.map(l => ({ value: l.id, label: l.nama })) },
                { type: 'select', name: 'kontakId', label: tipe === 'jual' ? 'Customer (opsional)' : 'Supplier',
                  options: kontakList.map(k => ({ value: k.id, label: k.nama })) },
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

    async bukaTambahBaris(transaksiId) {
        const produkList = await db.query('produk', p => p.aktif);
        if (!produkList.length) return alert('Belum ada produk aktif.');
        web.openDrawer({
            title: 'Tambah Baris Produk',
            fields: [
                { type: 'hidden', name: 'transaksiId', value: transaksiId },
                { type: 'select', name: 'produkId', label: 'Produk', required: true,
                  options: produkList.map(p => ({ value: p.id, label: `${p.nama} (Rp${(p.hargaJual || 0).toLocaleString('id-ID')})` })) },
                { type: 'number', name: 'qty', label: 'Jumlah', value: 1, required: true },
                { type: 'number', name: 'hargaSatuan', label: 'Harga Satuan', value: 0, required: true },
            ],
            submitText: 'Tambahkan Baris',
            onSubmit: 'event.preventDefault(); transaksiPage.simpanBaris(this);',
        });
    },

    /** Isi otomatis harga satuan sesuai harga jual/beli produk yang dipilih, dipanggil dari drawer lewat tombol. */
    async isiHargaOtomatis(select, tipe) {
        const p = await db.find('produk', x => x.id === select.value);
        if (!p) return;
        const harga = tipe === 'jual' ? p.hargaJual : p.hargaBeli;
        const input = select.closest('form').querySelector('[name="hargaSatuan"]');
        if (input) input.value = harga || 0;
    },

    async simpanBaris(form) {
        const val = (n) => form.querySelector(`[name="${n}"]`)?.value;
        const transaksiId = val('transaksiId');
        const produkId = val('produkId');
        if (!produkId) return alert('Pilih produk.');
        const qty = parseFloat(val('qty')) || 0;
        const hargaSatuan = parseFloat(val('hargaSatuan')) || 0;
        if (qty <= 0) return alert('Jumlah harus lebih dari 0.');

        try {
            await db.insert('transaksi_produk', { transaksiId, produkId, qty, hargaSatuan, subtotal: qty * hargaSatuan });
            await this._syncTotal(transaksiId);
        } catch (err) { return alert('Gagal menambah baris: ' + err.message); }

        web.closeDrawer();
        web.navigate(`transaksi/detail-${transaksiId}`);
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
        ? `<button class="slcBtn" onclick="transaksiPage.bukaTambahBaris('${id}')">+ Tambah Baris Produk</button>
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
