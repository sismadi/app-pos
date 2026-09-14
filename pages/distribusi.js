// ============================================================
// pages/distribusi.js — Distribusi stok (masuk/keluar) dengan baris
// produk (distribusi_produk). Berbeda dari produk.js/kontak.js: ini
// dokumen "header + baris", dan baru MENGUBAH STOK saat difinalisasi
// (status draft -> selesai), supaya dokumen bisa diedit dulu sebelum stok
// benar-benar bergerak.
// ============================================================
web.routes.distribusi = 'resolveDistribusi';

const distribusiPage = {
    // --- Baris produk sementara (diedit di form, disimpan saat submit) ---
    _lines: [],

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
                { type: 'select', name: 'lokasiId', label: tipe === 'masuk' ? 'Lokasi Tujuan' : 'Lokasi Asal', required: true,
                  options: lokasiList.map(l => ({ value: l.id, label: l.nama })) },
                { type: 'select', name: 'kontakId', label: tipe === 'masuk' ? 'Supplier/Distributor' : 'Kontak (opsional)',
                  options: kontakList.map(k => ({ value: k.id, label: k.nama })) },
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

    async bukaTambahBaris(distribusiId) {
        const produkList = await db.query('produk', p => p.aktif);
        if (!produkList.length) return alert('Belum ada produk aktif. Tambahkan produk terlebih dahulu.');
        web.openDrawer({
            title: 'Tambah Baris Produk',
            fields: [
                { type: 'hidden', name: 'distribusiId', value: distribusiId },
                { type: 'select', name: 'produkId', label: 'Produk', required: true,
                  options: produkList.map(p => ({ value: p.id, label: p.nama })) },
                { type: 'number', name: 'qty', label: 'Jumlah', value: 1, required: true },
                { type: 'number', name: 'hargaSatuan', label: 'Harga Satuan', value: 0 },
            ],
            submitText: 'Tambahkan Baris',
            onSubmit: 'event.preventDefault(); distribusiPage.simpanBaris(this);',
        });
    },

    async simpanBaris(form) {
        const val = (n) => form.querySelector(`[name="${n}"]`)?.value;
        const distribusiId = val('distribusiId');
        const produkId = val('produkId');
        if (!produkId) return alert('Pilih produk.');
        const qty = parseFloat(val('qty')) || 0;
        if (qty <= 0) return alert('Jumlah harus lebih dari 0.');

        try {
            await db.insert('distribusi_produk', {
                distribusiId, produkId, qty, hargaSatuan: parseFloat(val('hargaSatuan')) || 0,
            });
        } catch (err) { return alert('Gagal menambah baris: ' + err.message); }

        web.closeDrawer();
        web.navigate(`distribusi/detail-${distribusiId}`);
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
        ? `<button class="slcBtn" onclick="distribusiPage.bukaTambahBaris('${id}')">+ Tambah Baris Produk</button>
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
