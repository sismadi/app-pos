// ============================================================
// pages/distribusi.js — Distribusi stok (masuk/keluar) dengan baris
// produk (distribusi_produk). Berbeda dari produk.js/kontak.js: ini
// dokumen "header + baris", dan baru MENGUBAH STOK saat difinalisasi
// (status draft -> selesai), supaya dokumen bisa diedit dulu sebelum stok
// benar-benar bergerak. Header dibuat dulu (Lokasi + Kontak, lewat
// lokasiKontakFields() bersama), lalu baris produknya ditambah lewat
// katalog+keranjang BERSAMA (lihat pages/_shared.js) — komponen yang
// sama dipakai kasir & transaksi, jadi bisa tambah banyak produk
// sekaligus alih-alih satu-satu lewat dropdown.
// ============================================================
web.routes.distribusi = 'resolveDistribusi';

// --- Katalog+keranjang untuk menambah baris produk (reuse dari _shared.js) ---
const distribusiCatalogPage = createCatalogCart('distribusiCatalogPage', {
    cartTitle: 'Tambah Baris Produk',
    allowPriceEdit: true,
    getPrice: (p) => distribusiCatalogPage._tipe === 'masuk' ? (p.hargaBeli || 0) : (p.hargaJual || 0),
    getStock: (p) => distribusiCatalogPage._stokMap?.[p.id] ?? null,
    emptyCatalogMsg: 'Belum ada produk aktif.',
    emptyCartMsg: 'Belum ada produk dipilih. Ketuk produk di atas untuk menambah baris.',
    confirmLabel: (ctrl) => `Tambahkan ${ctrl.jumlahItem()} Baris Produk`,
    onConfirm: async (cart, form, ctrl) => {
        const distribusiId = ctrl._distribusiId;
        for (const c of cart) {
            await db.insert('distribusi_produk', {
                distribusiId, produkId: c.produkId, qty: c.qty, hargaSatuan: c.harga,
            });
        }
        web.closeDrawer();
        web.navigate(`distribusi/detail-${distribusiId}`);
    },
});

const distribusiPage = {
    async bukaTambah(tipe) {
        this._lines = [];
        const [lokasiList, kontakList] = await Promise.all([
            db.query('lokasi', () => true),
            db.query('kontak', k => tipe === 'masuk' ? (k.tipe === 'supplier' || k.tipe === 'distributor') : true),
        ]);
        if (!lokasiList.length) return alert('Buat lokasi terlebih dahulu di menu Lokasi.');

        web.openDrawer({
            title: tipe === 'masuk' ? 'Distribusi Masuk (dari Supplier)' : 'Distribusi Keluar (Mutasi Lokasi)',
            fields: [
                { type: 'hidden', name: 'tipe', value: tipe },
                { type: 'text',   name: 'nomor', label: 'Nomor Dokumen', placeholder: 'Opsional, otomatis jika kosong' },
                { type: 'text',   name: 'tanggal', label: 'Tanggal', value: new Date().toISOString().slice(0, 10) },
                ...lokasiKontakFields(lokasiList, kontakList, {
                    lokasiLabel: tipe === 'masuk' ? 'Lokasi Tujuan' : 'Lokasi Asal',
                    kontakLabel: tipe === 'masuk' ? 'Supplier/Distributor' : 'Kontak (opsional)',
                }),
                { type: 'textarea', name: 'catatan', label: 'Catatan' },
            ],
            submitText: 'Simpan sebagai Draft',
            onSubmit: 'event.preventDefault(); distribusiPage.simpanHeader(this);',
            lines: ['form:', '**Catatan:** tambahkan baris produk setelah dokumen dibuat (dari daftar distribusi).'],
        });
    },

    async simpanHeader(form) {
        const val = (n) => form.querySelector(`[name="${n}"]`)?.value;
        const data = {
            tipe: val('tipe'), nomor: val('nomor') || ('DIST-' + Date.now().toString(36).toUpperCase()),
            tanggal: val('tanggal') || new Date().toISOString().slice(0, 10),
            lokasiId: val('lokasiId'), kontakId: val('kontakId') || null,
            status: 'draft', catatan: val('catatan') || '',
        };
        if (!data.lokasiId) return alert('Lokasi wajib dipilih.');

        try { await db.insert('distribusi', { ...data, createdAt: new Date().toISOString() }); }
        catch (err) { return alert('Gagal menyimpan: ' + err.message); }

        web.closeDrawer();
        web.navigate('distribusi');
    },

    /** Tambah baris produk lewat katalog+keranjang bersama (bisa banyak
     *  produk sekaligus) — sama seperti kasir, konsisten & reuse. */
    async bukaTambahBaris(distribusiId, tipe) {
        const [produkList, dok] = await Promise.all([
            db.query('produk', p => p.aktif),
            db.find('distribusi', d => d.id === distribusiId),
        ]);
        if (!produkList.length) return alert('Belum ada produk aktif. Tambahkan produk terlebih dahulu.');
        const stokRows = dok ? await db.query('lokasi_produk', s => s.lokasiId === dok.lokasiId) : [];
        distribusiCatalogPage._distribusiId = distribusiId;
        distribusiCatalogPage._tipe = tipe;
        distribusiCatalogPage._stokMap = Object.fromEntries(stokRows.map(s => [s.produkId, s.stok]));
        distribusiCatalogPage.kataKunci = '';
        distribusiCatalogPage.kategoriAktif = '';
        distribusiCatalogPage.setProdukList(produkList);
        distribusiCatalogPage.openPicker(`Tambah Baris — Distribusi ${tipe === 'masuk' ? 'Masuk' : 'Keluar'}`);
    },

    async hapusBaris(id, distribusiId) {
        if (!confirm('Hapus baris ini?')) return;
        try { await db.remove('distribusi_produk', id); } catch (err) { return alert('Gagal menghapus: ' + err.message); }
        web.navigate(`distribusi/detail-${distribusiId}`);
    },

    /**
     * Finalisasi dokumen: status draft -> selesai, DAN barulah stok di
     * lokasi_produk benar-benar disesuaikan (tipe 'masuk' menambah stok,
     * 'keluar' mengurangi). Dilakukan sekali saja (dijaga lewat cek status).
     */
    async finalisasi(distribusiId) {
        if (!confirm('Finalisasi dokumen ini? Stok lokasi akan langsung disesuaikan dan tidak bisa diedit lagi.')) return;

        const dok = await db.find('distribusi', d => d.id === distribusiId);
        if (!dok) return alert('Dokumen tidak ditemukan.');
        if (dok.status === 'selesai') return alert('Dokumen ini sudah difinalisasi sebelumnya.');

        const baris = await db.query('distribusi_produk', b => b.distribusiId === distribusiId);
        if (!baris.length) return alert('Tambahkan minimal 1 baris produk sebelum difinalisasi.');

        try {
            for (const b of baris) {
                const existing = await db.find('lokasi_produk', s => s.lokasiId === dok.lokasiId && s.produkId === b.produkId);
                const stokLama = existing?.stok || 0;
                const delta = dok.tipe === 'masuk' ? b.qty : -b.qty;
                const stokBaru = stokLama + delta;
                if (existing) await db.update('lokasi_produk', existing.id, { stok: stokBaru });
                else await db.insert('lokasi_produk', { lokasiId: dok.lokasiId, produkId: b.produkId, stok: stokBaru, stokMinimum: 0 });
            }
            await db.update('distribusi', distribusiId, { status: 'selesai' });
        } catch (err) { return alert('Gagal memfinalisasi: ' + err.message); }

        alert('Dokumen berhasil difinalisasi, stok telah disesuaikan.');
        web.navigate(`distribusi/detail-${distribusiId}`);
    },

    async hapus(id) {
        if (!confirm('Hapus dokumen draft ini? (Dokumen yang sudah selesai sebaiknya tidak dihapus.)')) return;
        try { await db.remove('distribusi', id); } catch (err) { return alert('Gagal menghapus: ' + err.message); }
        web.navigate('distribusi');
    },
};

async function resolveDistribusi(sub) {
    const guard = requireLogin(['owner', 'gudang']);
    if (guard) return guard;

    if (sub && sub.startsWith('detail-')) return resolveDistribusiDetail(sub.replace('detail-', ''));

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
                `<button class="slcBtn" onclick="distribusiPage.bukaTambah('masuk')">+ Distribusi Masuk</button>
                 <button class="slcBtn" style="background:#555" onclick="distribusiPage.bukaTambah('keluar')">+ Distribusi Keluar</button>`,
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
        Aksi: dok.status === 'draft'
            ? `<button class="slcBtn" style="background:#c0392b" onclick="distribusiPage.hapusBaris('${b.id}','${id}')">Hapus</button>`
            : '-',
    }));

    const aksiHeader = dok.status === 'draft'
        ? `<button class="slcBtn" onclick="distribusiPage.bukaTambahBaris('${id}','${dok.tipe}')">+ Tambah Baris Produk</button>
           <button class="slcBtn" style="background:#1e824c" onclick="distribusiPage.finalisasi('${id}')">Finalisasi</button>
           <button class="slcBtn" style="background:#c0392b" onclick="distribusiPage.hapus('${id}')">Hapus Dokumen</button>`
        : '';

    return [
        { section: 'titleHero', title: `Distribusi ${dok.tipe === 'masuk' ? 'Masuk' : 'Keluar'} — ${dok.nomor}`,
          description: `Lokasi: <strong>${lokasi?.nama || '-'}</strong> &middot; Kontak: <strong>${kontak?.nama || '-'}</strong> &middot; Status: <strong>${dok.status === 'selesai' ? 'Selesai' : 'Draft'}</strong>` },
        {
            section: 'articleFull',
            subtitle: `Baris Produk (${baris.length})`,
            lines: [
                `${aksiHeader}
                 <button class="slcBtn" style="background:#555" onclick="web.navigate('distribusi')">&larr; Kembali</button>`,
                `table:${JSON.stringify(tableRows)}`,
            ],
            emptyText: 'Belum ada baris produk pada dokumen ini.',
        },
    ];
}
