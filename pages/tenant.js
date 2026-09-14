// ============================================================
// pages/tenant.js — Kelola daftar tenant (toko), khusus superadmin.
// Tabel `tenants` TIDAK di-scope (lihat db.js: allTenants/insertTenant/
// updateTenant lewat jalur khusus, bukan db.all/db.insert biasa).
// ============================================================
web.routes.tenant = 'resolveTenant';

const tenantPage = {
    bukaTambah() {
        web.openDrawer({
            title: 'Tambah Tenant Baru',
            fields: [
                { type: 'text', name: 'kodeToko', label: 'Kode Toko', required: true },
                { type: 'text', name: 'nama', label: 'Nama Toko', required: true },
                { type: 'text', name: 'alamat', label: 'Alamat' },
                { type: 'text', name: 'telepon', label: 'Telepon' },
                { type: 'text', name: 'ownerUsername', label: 'Username Pemilik', required: true },
                { type: 'text', name: 'ownerPassword', label: 'Password Pemilik', required: true },
                { type: 'text', name: 'ownerName', label: 'Nama Pemilik', required: true },
            ],
            submitText: 'Buat Tenant',
            onSubmit: 'event.preventDefault(); tenantPage.simpanBaru(this);',
        });
    },

    async simpanBaru(form) {
        const val = (n) => form.querySelector(`[name="${n}"]`)?.value.trim();
        const kodeToko = val('kodeToko').toUpperCase();
        if (!kodeToko || !val('nama') || !val('ownerUsername') || !val('ownerPassword')) return alert('Field bertanda * wajib diisi.');
        if (kodeToko === auth.SUPERADMIN_KODE) return alert('Kode Toko tersebut tidak dapat dipakai.');

        try {
            const tenants = await db.allTenants();
            if (tenants.some(t => t.kodeToko.toUpperCase() === kodeToko)) return alert('Kode Toko sudah dipakai.');

            const tenant = await db.insertTenant({
                kodeToko, nama: val('nama'), alamat: val('alamat'), telepon: val('telepon'),
                status: 'aktif', createdAt: new Date().toISOString(),
            });
            await db.insertForTenant('users', tenant.id, {
                username: val('ownerUsername'), password: val('ownerPassword'), name: val('ownerName'),
                role: 'owner', createdAt: new Date().toISOString(),
            });
            await db.insertForTenant('lokasi', tenant.id, {
                nama: 'Toko Utama', tipe: 'toko', alamat: val('alamat') || '', createdAt: new Date().toISOString(),
            });
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
            ? `<button class="slcBtn" style="background:#c0392b" onclick="tenantPage.toggleStatus('${t.id}','nonaktif')">Nonaktifkan</button>`
            : `<button class="slcBtn" style="background:#1e824c" onclick="tenantPage.toggleStatus('${t.id}','aktif')">Aktifkan</button>`,
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
            emptyText: 'Belum ada tenant terdaftar selain akun superadmin.',
        },
    ];
}
