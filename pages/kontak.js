// ============================================================
// pages/kontak.js — CRUD kontak (distributor/supplier/customer/lainnya).
// Pola SAMA PERSIS dengan produk.js, lebih sederhana (field lebih sedikit).
// [SECURITY] lihat catatan rawKeys/JSON.stringify di produk.js.
// ============================================================
web.routes.kontak = 'resolveKontak';

const TIPE_KONTAK = [
    { value: 'distributor', label: 'Distributor' },
    { value: 'supplier',    label: 'Supplier' },
    { value: 'customer',    label: 'Customer' },
    { value: 'lainnya',     label: 'Lainnya' },
];

const kontakPage = {
    fields(k = {}) {
        return [
            { type: 'hidden', name: 'id', value: k.id || '' },
            { type: 'text',   name: 'nama',    label: 'Nama',   value: k.nama || '', required: true, maxlength: 120 },
            { type: 'select', name: 'tipe',    label: 'Tipe',   value: k.tipe || 'customer', options: TIPE_KONTAK, required: true },
            { type: 'text',   name: 'telepon', label: 'Telepon', value: k.telepon || '', maxlength: 30 },
            { type: 'text',   name: 'email',   label: 'Email',  value: k.email || '', maxlength: 120 },
            { type: 'textarea', name: 'alamat', label: 'Alamat', value: k.alamat || '', maxlength: 200 },
        ];
    },

    bukaTambah() {
        web.openDrawer({
            title: 'Tambah Kontak', fields: this.fields(), submitText: 'Simpan Kontak',
            onSubmit: 'event.preventDefault(); kontakPage.simpan(this);',
        });
    },

    async bukaEdit(id) {
        const k = await db.find('kontak', x => x.id === id);
        if (!k) return alert('Kontak tidak ditemukan.');
        web.openDrawer({
            title: 'Edit Kontak', fields: this.fields(k), submitText: 'Simpan Perubahan',
            onSubmit: 'event.preventDefault(); kontakPage.simpan(this);',
        });
    },

    async simpan(form) {
        const val = (n) => form.querySelector(`[name="${n}"]`)?.value;
        const id = val('id');
        const data = {
            nama: val('nama').trim(), tipe: val('tipe'), telepon: val('telepon'),
            email: val('email'), alamat: val('alamat'),
        };
        if (!data.nama || !data.tipe) return alert('Nama dan tipe kontak wajib diisi.');

        try {
            if (id) await db.update('kontak', id, data);
            else await db.insert('kontak', { ...data, createdAt: new Date().toISOString() });
        } catch (err) { return alert('Gagal menyimpan: ' + err.message); }

        web.closeDrawer();
        web.navigate('kontak');
    },

    async hapus(id) {
        if (!confirm('Hapus kontak ini?')) return;
        try { await db.remove('kontak', id); } catch (err) { return alert('Gagal menghapus: ' + err.message); }
        web.navigate('kontak');
    },
};

function tipeKontakLabel(tipe) {
    return TIPE_KONTAK.find(t => t.value === tipe)?.label || tipe;
}

async function resolveKontak() {
    const guard = requireLogin(['owner', 'kasir', 'gudang']);
    if (guard) return guard;

    const rows = await db.query('kontak', () => true);
    const tableRows = rows.map(k => ({
        Nama: k.nama,
        Tipe: `<span class="badge">${escHtml(tipeKontakLabel(k.tipe))}</span>`,
        Telepon: k.telepon || '-',
        Email: k.email || '-',
        Alamat: k.alamat || '-',
        Aksi: `<button class="slcBtn" onclick='kontakPage.bukaEdit(${JSON.stringify(k.id)})'>Edit</button>
               <button class="slcBtn" style="background:#c0392b" onclick='kontakPage.hapus(${JSON.stringify(k.id)})'>Hapus</button>`,
    }));

    return [
        { section: 'titleHero', title: 'Kontak', description: 'Distributor, supplier, customer, dan kontak lainnya.' },
        {
            section: 'articleFull',
            subtitle: `Daftar Kontak (${rows.length})`,
            lines: [
                '<button class="slcBtn" onclick="kontakPage.bukaTambah()">+ Tambah Kontak</button>',
                `table:${JSON.stringify(tableRows)}`,
            ],
            tableOpts: { rawKeys: ['Tipe', 'Aksi'] },
            emptyText: 'Belum ada kontak. Klik "+ Tambah Kontak" untuk mulai.',
        },
    ];
}
