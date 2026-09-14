// ============================================================
// pages/produk.js — CRUD master produk. Pola di file ini (list + drawer
// tambah/edit + hapus) dipakai ULANG oleh kontak.js, lokasi.js, dst.
// dengan bentuk yang sama, hanya field & tabelnya yang berbeda.
// ============================================================
web.routes.produk = 'resolveProduk';

const produkPage = {
    fields(p = {}) {
        return [
            { type: 'hidden', name: 'id', value: p.id || '' },
            { type: 'text',   name: 'kode',      label: 'Kode',       value: p.kode || '' },
            { type: 'text',   name: 'nama',      label: 'Nama Produk', value: p.nama || '', required: true },
            { type: 'text',   name: 'kategori',  label: 'Kategori',   value: p.kategori || '' },
            { type: 'select', name: 'satuan',    label: 'Satuan',     value: p.satuan || 'pcs',
              options: ['pcs', 'kg', 'gram', 'liter', 'botol', 'karung', 'dus', 'pak'] },
            { type: 'number', name: 'hargaBeli', label: 'Harga Beli', value: p.hargaBeli ?? 0 },
            { type: 'number', name: 'hargaJual', label: 'Harga Jual', value: p.hargaJual ?? 0, required: true },
            { type: 'select', name: 'aktif',     label: 'Status',     value: p.aktif ?? 1,
              options: [{ value: 1, label: 'Aktif' }, { value: 0, label: 'Nonaktif' }] },
        ];
    },

    bukaTambah() {
        web.openDrawer({
            title: 'Tambah Produk',
            fields: this.fields(),
            submitText: 'Simpan Produk',
            onSubmit: 'event.preventDefault(); produkPage.simpan(this);',
        });
    },

    async bukaEdit(id) {
        const p = await db.find('produk', x => x.id === id);
        if (!p) return alert('Produk tidak ditemukan.');
        web.openDrawer({
            title: 'Edit Produk',
            fields: this.fields(p),
            submitText: 'Simpan Perubahan',
            onSubmit: 'event.preventDefault(); produkPage.simpan(this);',
        });
    },

    async simpan(form) {
        const val = (n) => form.querySelector(`[name="${n}"]`)?.value;
        const id = val('id');
        const data = {
            kode: val('kode'), nama: val('nama').trim(), kategori: val('kategori'),
            satuan: val('satuan'), hargaBeli: parseFloat(val('hargaBeli')) || 0,
            hargaJual: parseFloat(val('hargaJual')) || 0, aktif: parseInt(val('aktif'), 10),
        };
        if (!data.nama) return alert('Nama produk wajib diisi.');

        try {
            if (id) await db.update('produk', id, data);
            else await db.insert('produk', { ...data, createdAt: new Date().toISOString() });
        } catch (err) { return alert('Gagal menyimpan: ' + err.message); }

        web.closeDrawer();
        web.navigate('produk');
    },

    async hapus(id) {
        if (!confirm('Hapus produk ini? Data stok terkait di semua lokasi juga sebaiknya dihapus manual.')) return;
        try { await db.remove('produk', id); } catch (err) { return alert('Gagal menghapus: ' + err.message); }
        web.navigate('produk');
    },
};

async function resolveProduk() {
    const guard = requireLogin(['owner', 'gudang']);
    if (guard) return guard;

    const rows = await db.query('produk', () => true);
    const tableRows = rows.map(p => ({
        Kode: p.kode || '-',
        Nama: p.nama,
        Kategori: p.kategori || '-',
        Satuan: p.satuan,
        'Harga Beli': formatRupiah(p.hargaBeli),
        'Harga Jual': formatRupiah(p.hargaJual),
        Status: p.aktif ? '<span class="badge">Aktif</span>' : '<span class="badge badge-muted">Nonaktif</span>',
        Aksi: `<button class="slcBtn" onclick="produkPage.bukaEdit('${p.id}')">Edit</button>
               <button class="slcBtn" style="background:#c0392b" onclick="produkPage.hapus('${p.id}')">Hapus</button>`,
    }));

    return [
        { section: 'titleHero', title: 'Produk', description: 'Kelola master produk milik toko Anda.' },
        {
            section: 'articleFull',
            subtitle: `Daftar Produk (${rows.length})`,
            lines: [
                '<button class="slcBtn" onclick="produkPage.bukaTambah()">+ Tambah Produk</button>',
                `table:${JSON.stringify(tableRows)}`,
            ],
            emptyText: 'Belum ada produk. Klik "+ Tambah Produk" untuk mulai.',
        },
    ];
}

/** Helper format rupiah — dipakai juga oleh halaman lain (transaksi, distribusi, dashboard). */
function formatRupiah(n) {
    const num = Number(n) || 0;
    return 'Rp' + num.toLocaleString('id-ID');
}
