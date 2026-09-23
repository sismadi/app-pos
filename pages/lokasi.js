// ============================================================
// pages/lokasi.js — CRUD lokasi (toko/gudang) + kelola stok per lokasi
// (tabel lokasi_produk). Pola CRUD lokasi identik dengan produk.js/kontak.js;
// bagian tambahan di sini adalah panel "Stok di Lokasi Ini".
// [SECURITY] lihat catatan rawKeys/JSON.stringify di produk.js.
// ============================================================
web.routes.lokasi = 'resolveLokasi';

const lokasiPage = {
    fields(l = {}) {
        return [
            { type: 'hidden', name: 'id', value: l.id || '' },
            { type: 'text',   name: 'nama', label: 'Nama Lokasi', value: l.nama || '', required: true, maxlength: 120 },
            { type: 'select', name: 'tipe', label: 'Tipe', value: l.tipe || 'toko',
              options: [{ value: 'toko', label: 'Toko' }, { value: 'gudang', label: 'Gudang' }], required: true },
            { type: 'textarea', name: 'alamat', label: 'Alamat', value: l.alamat || '', maxlength: 200 },
        ];
    },

    bukaTambah() {
        web.openDrawer({
            title: 'Tambah Lokasi', fields: this.fields(), submitText: 'Simpan Lokasi',
            onSubmit: 'event.preventDefault(); lokasiPage.simpan(this);',
        });
    },

    async bukaEdit(id) {
        const l = await db.find('lokasi', x => x.id === id);
        if (!l) return alert('Lokasi tidak ditemukan.');
        web.openDrawer({
            title: 'Edit Lokasi', fields: this.fields(l), submitText: 'Simpan Perubahan',
            onSubmit: 'event.preventDefault(); lokasiPage.simpan(this);',
        });
    },

    async simpan(form) {
        const val = (n) => form.querySelector(`[name="${n}"]`)?.value;
        const id = val('id');
        const data = { nama: val('nama').trim(), tipe: val('tipe'), alamat: val('alamat') };
        if (!data.nama) return alert('Nama lokasi wajib diisi.');

        try {
            if (id) { await db.update('lokasi', id, data); }
            else { await db.insert('lokasi', { ...data, createdAt: new Date().toISOString() }); }
        } catch (err) { return alert('Gagal menyimpan: ' + err.message); }

        web.closeDrawer();
        web.navigate('lokasi');
    },

    async hapus(id) {
        if (!confirm('Hapus lokasi ini? Data stok di lokasi ini sebaiknya dihapus/dipindah dulu.')) return;
        try { await db.remove('lokasi', id); } catch (err) { return alert('Gagal menghapus: ' + err.message); }
        web.navigate('lokasi');
    },

    // --- Kelola stok per lokasi (lokasi_produk) -----------------------
    async bukaAturStok(lokasiId) {
        const produkList = await db.query('produk', p => p.aktif);
        web.openDrawer({
            title: 'Atur Stok Produk di Lokasi Ini',
            fields: [
                { type: 'hidden', name: 'lokasiId', value: lokasiId },
                { type: 'select', name: 'produkId', label: 'Produk', required: true,
                  options: produkList.map(p => ({ value: p.id, label: p.nama })) },
                { type: 'number', name: 'stok', label: 'Stok', value: 0, required: true },
                { type: 'number', name: 'stokMinimum', label: 'Stok Minimum', value: 0 },
            ],
            submitText: 'Simpan Stok',
            onSubmit: 'event.preventDefault(); lokasiPage.simpanStok(this);',
        });
    },

    async simpanStok(form) {
        const val = (n) => form.querySelector(`[name="${n}"]`)?.value;
        const lokasiId = val('lokasiId');
        const produkId = val('produkId');
        if (!produkId) return alert('Pilih produk terlebih dahulu.');

        const stok = parseFloat(val('stok')) || 0;
        const stokMinimum = parseFloat(val('stokMinimum')) || 0;

        try {
            const existing = await db.find('lokasi_produk', x => x.lokasiId === lokasiId && x.produkId === produkId);
            if (existing) await db.update('lokasi_produk', existing.id, { stok, stokMinimum });
            else await db.insert('lokasi_produk', { lokasiId, produkId, stok, stokMinimum });
        } catch (err) { return alert('Gagal menyimpan stok: ' + err.message); }

        web.closeDrawer();
        web.navigate(`lokasi/detail-${lokasiId}`);
    },

    async hapusStok(id, lokasiId) {
        if (!confirm('Hapus baris stok ini?')) return;
        try { await db.remove('lokasi_produk', id); } catch (err) { return alert('Gagal menghapus: ' + err.message); }
        web.navigate(`lokasi/detail-${lokasiId}`);
    },
};

async function resolveLokasi(sub) {
    const guard = requireLogin(['owner', 'gudang']);
    if (guard) return guard;

    if (sub && sub.startsWith('detail-')) return resolveLokasiDetail(sub.replace('detail-', ''));

    const rows = await db.query('lokasi', () => true);
    const tableRows = rows.map(l => ({
        Nama: l.nama,
        Tipe: `<span class="badge">${l.tipe === 'toko' ? 'Toko' : 'Gudang'}</span>`,
        Alamat: l.alamat || '-',
        Aksi: `<button class="slcBtn" onclick='web.navigate(${JSON.stringify('lokasi/detail-' + l.id)})'>Lihat Stok</button>
               <button class="slcBtn" onclick='lokasiPage.bukaEdit(${JSON.stringify(l.id)})'>Edit</button>
               <button class="slcBtn" style="background:#c0392b" onclick='lokasiPage.hapus(${JSON.stringify(l.id)})'>Hapus</button>`,
    }));

    return [
        { section: 'titleHero', title: 'Lokasi', description: 'Toko dan gudang milik bisnis Anda.' },
        {
            section: 'articleFull',
            subtitle: `Daftar Lokasi (${rows.length})`,
            lines: [
                '<button class="slcBtn" onclick="lokasiPage.bukaTambah()">+ Tambah Lokasi</button>',
                `table:${JSON.stringify(tableRows)}`,
            ],
            tableOpts: { rawKeys: ['Tipe', 'Aksi'] },
            emptyText: 'Belum ada lokasi. Klik "+ Tambah Lokasi" untuk mulai.',
        },
    ];
}

async function resolveLokasiDetail(lokasiId) {
    const lokasi = await db.find('lokasi', l => l.id === lokasiId);
    if (!lokasi) return [{ section: 'titleHero', title: 'Lokasi Tidak Ditemukan' }];

    const [stokRows, produkList] = await Promise.all([
        db.query('lokasi_produk', s => s.lokasiId === lokasiId),
        db.query('produk', () => true),
    ]);
    const produkById = Object.fromEntries(produkList.map(p => [p.id, p]));

    const tableRows = stokRows.map(s => {
        const p = produkById[s.produkId] || {};
        const rendah = s.stok <= (s.stokMinimum || 0);
        return {
            Produk: p.nama || '(produk terhapus)',
            Stok: rendah ? `<strong style="color:#c0392b">${escHtml(String(s.stok))}</strong>` : s.stok,
            'Stok Minimum': s.stokMinimum ?? 0,
            Satuan: p.satuan || '-',
            Aksi: `<button class="slcBtn" style="background:#c0392b" onclick='lokasiPage.hapusStok(${JSON.stringify(s.id)},${JSON.stringify(lokasiId)})'>Hapus</button>`,
        };
    });

    return [
        { section: 'titleHero', title: `Stok — ${escHtml(lokasi.nama)}`, description: `Tipe: <strong>${lokasi.tipe === 'toko' ? 'Toko' : 'Gudang'}</strong>` },
        {
            section: 'articleFull',
            subtitle: `Stok Produk di Lokasi Ini (${stokRows.length})`,
            lines: [
                `<button class="slcBtn" onclick='lokasiPage.bukaAturStok(${JSON.stringify(lokasiId)})'>+ Atur Stok Produk</button>
                 <button class="slcBtn" style="background:#555" onclick="web.navigate('lokasi')">&larr; Kembali ke Daftar Lokasi</button>`,
                `table:${JSON.stringify(tableRows)}`,
            ],
            tableOpts: { rawKeys: ['Stok', 'Aksi'] },
            emptyText: 'Belum ada stok tercatat di lokasi ini.',
        },
    ];
}
