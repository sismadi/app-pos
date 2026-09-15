// ============================================================
// pages/akun.js — CRUD Bagan Akun (Chart of Accounts / COA). Pola di
// file ini SAMA PERSIS dengan produk.js (list + drawer tambah/edit +
// hapus, lihat komentar di sana) — akun adalah master data yang dipakai
// oleh Jurnal (pages/jurnal.js) dan Laporan Keuangan (pages/laporan.js).
// Hanya peran 'owner' yang boleh membuka menu ini (data keuangan).
// ============================================================
web.routes.akun = 'resolveAkun';

/** Lima tipe akun baku + saldo normalnya masing-masing — dipakai juga
 *  oleh jurnal.js & laporan.js untuk mengelompokkan Neraca/Laba-Rugi/Ekuitas. */
const TIPE_AKUN = [
    { value: 'aset',       label: 'Aset',       saldoNormal: 'debit' },
    { value: 'kewajiban',  label: 'Kewajiban',  saldoNormal: 'kredit' },
    { value: 'ekuitas',    label: 'Ekuitas',    saldoNormal: 'kredit' },
    { value: 'pendapatan', label: 'Pendapatan', saldoNormal: 'kredit' },
    { value: 'beban',      label: 'Beban',      saldoNormal: 'debit' },
];
function saldoNormalUntukTipe(tipe) { return TIPE_AKUN.find(t => t.value === tipe)?.saldoNormal || 'debit'; }
function labelTipeAkun(tipe) { return TIPE_AKUN.find(t => t.value === tipe)?.label || tipe; }

const akunPage = {
    fields(a = {}) {
        return [
            { type: 'hidden', name: 'id', value: a.id || '' },
            { type: 'text',   name: 'kode', label: 'Kode Akun', value: a.kode || '', required: true, placeholder: 'mis. 1101' },
            { type: 'text',   name: 'nama', label: 'Nama Akun', value: a.nama || '', required: true },
            { type: 'select', name: 'tipe', label: 'Tipe Akun', value: a.tipe || 'aset',
              options: TIPE_AKUN.map(t => ({ value: t.value, label: t.label })) },
            { type: 'number', name: 'saldoAwal', label: 'Saldo Awal', value: a.saldoAwal ?? 0 },
            { type: 'select', name: 'aktif', label: 'Status', value: a.aktif ?? 1,
              options: [{ value: 1, label: 'Aktif' }, { value: 0, label: 'Nonaktif' }] },
        ];
    },

    bukaTambah() {
        web.openDrawer({
            title: 'Tambah Akun',
            fields: this.fields(),
            submitText: 'Simpan Akun',
            onSubmit: 'event.preventDefault(); akunPage.simpan(this);',
        });
    },

    async bukaEdit(id) {
        const a = await db.find('akun', x => x.id === id);
        if (!a) return alert('Akun tidak ditemukan.');
        web.openDrawer({
            title: 'Edit Akun',
            fields: this.fields(a),
            submitText: 'Simpan Perubahan',
            onSubmit: 'event.preventDefault(); akunPage.simpan(this);',
        });
    },

    async simpan(form) {
        const val = (n) => form.querySelector(`[name="${n}"]`)?.value;
        const id = val('id');
        const tipe = val('tipe');
        const data = {
            kode: val('kode').trim(),
            nama: val('nama').trim(),
            tipe,
            saldoNormal: saldoNormalUntukTipe(tipe), // turunan otomatis dari tipe, tidak diinput manual
            saldoAwal: parseFloat(val('saldoAwal')) || 0,
            aktif: parseInt(val('aktif'), 10),
        };
        if (!data.kode || !data.nama) return alert('Kode dan nama akun wajib diisi.');

        const dobel = await db.query('akun', x => x.kode === data.kode && x.id !== id);
        if (dobel.length) return alert('Kode akun sudah dipakai, gunakan kode lain.');

        try {
            if (id) await db.update('akun', id, data);
            else await db.insert('akun', { ...data, createdAt: new Date().toISOString() });
        } catch (err) { return alert('Gagal menyimpan: ' + err.message); }

        web.closeDrawer();
        web.navigate('akun');
    },

    async hapus(id) {
        const dipakai = await db.query('jurnal_detail', d => d.akunId === id);
        if (dipakai.length) return alert('Akun ini sudah dipakai di jurnal dan tidak dapat dihapus — nonaktifkan saja lewat tombol Edit.');
        if (!confirm('Hapus akun ini?')) return;
        try { await db.remove('akun', id); } catch (err) { return alert('Gagal menghapus: ' + err.message); }
        web.navigate('akun');
    },
};

async function resolveAkun() {
    const guard = requireLogin(['owner']);
    if (guard) return guard;

    const rows = await db.query('akun', () => true);
    const tableRows = rows
        .sort((a, b) => a.kode.localeCompare(b.kode))
        .map(a => ({
            Kode: a.kode,
            Nama: a.nama,
            Tipe: labelTipeAkun(a.tipe),
            'Saldo Normal': a.saldoNormal === 'debit' ? 'Debit' : 'Kredit',
            'Saldo Awal': formatRupiah(a.saldoAwal),
            Status: a.aktif ? '<span class="badge">Aktif</span>' : '<span class="badge badge-muted">Nonaktif</span>',
            Aksi: `<button class="slcBtn" onclick="akunPage.bukaEdit('${a.id}')">Edit</button>
                   <button class="slcBtn" style="background:#c0392b" onclick="akunPage.hapus('${a.id}')">Hapus</button>`,
        }));

    return [
        { section: 'titleHero', title: 'Bagan Akun (COA)', description: 'Daftar akun untuk pencatatan Jurnal dan dasar perhitungan Neraca, Laba Rugi, serta Perubahan Ekuitas.' },
        {
            section: 'articleFull',
            subtitle: `Daftar Akun (${rows.length})`,
            lines: [
                `<button class="slcBtn" onclick="akunPage.bukaTambah()">+ Tambah Akun</button>
                 <button class="slcBtn" style="background:#555" onclick="web.navigate('jurnal')">Lihat Jurnal</button>
                 <button class="slcBtn" style="background:#555" onclick="web.navigate('laporan')">Lihat Laporan Keuangan</button>`,
                `table:${JSON.stringify(tableRows)}`,
            ],
            emptyText: 'Belum ada akun. Klik "+ Tambah Akun" untuk mulai.',
        },
    ];
}
