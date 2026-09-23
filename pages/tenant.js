// ============================================================
// pages/tenant.js — Kelola daftar tenant (toko), khusus superadmin.
// Tabel `tenants` TIDAK di-scope (lihat db.js: allTenants/insertTenant/
// updateTenant lewat jalur khusus, bukan db.all/db.insert biasa).
//
// [SECURITY] db.insertTenant() sekarang SATU panggilan ke
// POST /api?table=tenants — backend (handleTenantsTable di worker.js)
// yang membuat baris tenants + users (password di-hash PBKDF2 di sana)
// + lokasi "Toko Utama" sekaligus, dan menolak permintaan ini kalau
// sesi yang memanggil bukan superadmin. Versi lama merakit 3 panggilan
// terpisah (insertTenant lalu insertForTenant('users', ...) dengan
// PASSWORD PLAINTEXT di body) dari klien — itu sama saja mengetik
// password pengguna baru dalam bentuk polos lewat jaringan.
// ============================================================
web.routes.tenant = 'resolveTenant';

const tenantPage = {
    bukaTambah() {
        web.openDrawer({
            title: 'Tambah Tenant Baru',
            fields: [
                { type: 'text', name: 'kodeToko', label: 'Kode Toko', required: true },
                { type: 'text', name: 'nama', label: 'Nama Toko', required: true, maxlength: 80 },
                { type: 'text', name: 'alamat', label: 'Alamat', maxlength: 200 },
                { type: 'text', name: 'telepon', label: 'Telepon', maxlength: 30 },
                { type: 'text', name: 'ownerUsername', label: 'Username Pemilik', required: true },
                { type: 'password', name: 'ownerPassword', label: 'Password Pemilik (min. 8 karakter)', required: true, autocomplete: 'new-password' },
                { type: 'text', name: 'ownerName', label: 'Nama Pemilik', required: true, maxlength: 80 },
            ],
            submitText: 'Buat Tenant',
            onSubmit: 'event.preventDefault(); tenantPage.simpanBaru(this);',
        });
    },

    async simpanBaru(form) {
        const val = (n) => form.querySelector(`[name="${n}"]`)?.value.trim();
        const payload = {
            kodeToko: val('kodeToko').toUpperCase(),
            nama: val('nama'),
            alamat: val('alamat'),
            telepon: val('telepon'),
            ownerUsername: val('ownerUsername'),
            ownerPassword: form.querySelector('[name="ownerPassword"]').value,
            ownerName: val('ownerName'),
        };
        if (!payload.kodeToko || !payload.nama || !payload.ownerUsername || !payload.ownerPassword || !payload.ownerName) {
            return alert('Field bertanda * wajib diisi.');
        }

        try {
            await db.insertTenant(payload);
        } catch (err) { return alert('Gagal membuat tenant: ' + err.message); }

        web.closeDrawer();
        web.navigate('tenant');
    },

    async toggleStatus(id, statusBaru) {
        if (!confirm(`Ubah status tenant ini menjadi "${statusBaru}"?`)) return;
        try { await db.updateTenant(id, { status: statusBaru }); }
        catch (err) { return alert('Gagal memperbarui: ' + err.message); }
        web.navigate('tenant');
    },
};

async function resolveTenant() {
    const guard = requireLogin(['superadmin']);
    if (guard) return guard;

    const tenants = (await db.allTenants()).filter(t => t.id !== 'system');
    const tableRows = tenants.map(t => ({
        'Kode Toko': t.kodeToko,
        Nama: t.nama,
        Telepon: t.telepon || '-',
        Status: t.status === 'aktif' ? '<span class="badge badge-success">Aktif</span>' : '<span class="badge badge-muted">Nonaktif</span>',
        Aksi: t.status === 'aktif'
            ? `<button class="slcBtn" style="background:#c0392b" onclick='tenantPage.toggleStatus(${JSON.stringify(t.id)},"nonaktif")'>Nonaktifkan</button>`
            : `<button class="slcBtn" style="background:#1e824c" onclick='tenantPage.toggleStatus(${JSON.stringify(t.id)},"aktif")'>Aktifkan</button>`,
    }));

    return [
        { section: 'titleHero', title: 'Kelola Tenant', description: 'Daftar seluruh toko yang terdaftar di aplikasi ini.' },
        {
            section: 'articleFull',
            subtitle: `Daftar Tenant (${tenants.length})`,
            lines: [
                '<button class="slcBtn" onclick="tenantPage.bukaTambah()">+ Tambah Tenant</button>',
                `table:${JSON.stringify(tableRows)}`,
            ],
            tableOpts: { rawKeys: ['Status', 'Aksi'] },
            emptyText: 'Belum ada tenant terdaftar selain akun superadmin.',
        },
    ];
}
