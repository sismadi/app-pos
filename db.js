// ============================================================
// db.js — Lapisan akses data (fetch ke Worker API) + auto tenant-scoping.
// ============================================================
// Sama seperti versi MOOC (all/find/query/insert/update/remove/upsertBy
// dipertahankan), TAPI setiap tabel bisnis di SCOPED_TABLES otomatis:
//   - menambahkan ?tenantId=<tenant sesi aktif> di setiap GET/PATCH/DELETE
//   - menyisipkan tenantId ke body setiap POST (insert)
// supaya HALAMAN (produk.js, kontak.js, dst.) tidak perlu mengurus
// tenantId sendiri di tiap panggilan — cukup panggil db.all('produk')
// dsb. seperti biasa, isolasi tenant otomatis mengikuti sesi login.
//
// Untuk ALUR LOGIN/REGISTRASI (belum ada sesi, tenantId dipilih manual
// lewat "Kode Toko") disediakan db.allForTenant()/db.insertForTenant()
// sebagai jalur eksplisit — dipakai HANYA oleh auth.js.
// ============================================================
const API_BASE = 'pos-api.sismadi.workers.dev/api';

const SCOPED_TABLES = new Set([
    'users', 'produk', 'lokasi', 'lokasi_produk', 'kontak',
    'distribusi', 'distribusi_produk',
    'transaksi', 'transaksi_produk',
    'payment',
]);

async function apiGet(path) {
    const res = await fetch(`${API_BASE}/${path}`);
    if (!res.ok) {
        let msg = `GET ${path} gagal (${res.status})`;
        try { const j = await res.json(); if (j?.error) msg = j.error; } catch (e) {}
        throw new Error(msg);
    }
    return res.json();
}

async function apiSend(method, path, body) {
    const res = await fetch(`${API_BASE}/${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 404) return null;
    if (!res.ok) {
        let msg = `${method} ${path} gagal (${res.status})`;
        try { const j = await res.json(); if (j?.error) msg = j.error; } catch (e) {}
        throw new Error(msg);
    }
    return res.json();
}

function activeTenantId() {
    const user = (typeof auth !== 'undefined') ? auth.currentUser() : null;
    return user?.tenantId || null;
}

function requireTenant() {
    const t = activeTenantId();
    if (!t) throw new Error('Tidak ada sesi tenant aktif — silakan masuk kembali.');
    return t;
}

const db = {
    async all(table) {
        let path = table;
        if (SCOPED_TABLES.has(table)) path += `?tenantId=${encodeURIComponent(requireTenant())}`;
        return apiGet(path);
    },

    async find(table, predicate) {
        const rows = await this.all(table);
        return rows.find(predicate) || null;
    },

    async query(table, predicate) {
        const rows = await this.all(table);
        return rows.filter(predicate);
    },

    async insert(table, row) {
        const body = { ...row };
        let path = table;
        if (SCOPED_TABLES.has(table)) {
            const t = requireTenant();
            body.tenantId = t;
            path += `?tenantId=${encodeURIComponent(t)}`;
        }
        return apiSend('POST', path, body);
    },

    async update(table, id, patch) {
        let path = `${table}/${id}`;
        if (SCOPED_TABLES.has(table)) path += `?tenantId=${encodeURIComponent(requireTenant())}`;
        return apiSend('PATCH', path, patch);
    },

    async remove(table, id) {
        let path = `${table}/${id}`;
        if (SCOPED_TABLES.has(table)) path += `?tenantId=${encodeURIComponent(requireTenant())}`;
        await apiSend('DELETE', path);
        return true;
    },

    async upsertBy(table, matchFn, row) {
        const rows = await this.all(table);
        const existing = rows.find(matchFn);
        if (!existing) return this.insert(table, row);
        return this.update(table, existing.id, row);
    },

    // --- Jalur eksplisit lintas-tenant, HANYA untuk auth.js (login/registrasi) ---
    async allForTenant(table, tenantId) {
        let path = table;
        if (SCOPED_TABLES.has(table)) path += `?tenantId=${encodeURIComponent(tenantId)}`;
        return apiGet(path);
    },

    async insertForTenant(table, tenantId, row) {
        const body = { ...row };
        let path = table;
        if (SCOPED_TABLES.has(table)) {
            body.tenantId = tenantId;
            path += `?tenantId=${encodeURIComponent(tenantId)}`;
        }
        return apiSend('POST', path, body);
    },

    // --- Tabel `tenants` sendiri TIDAK di-scope (global) ---
    async allTenants() { return apiGet('tenants'); },
    async insertTenant(row) { return apiSend('POST', 'tenants', row); },
    async updateTenant(id, patch) { return apiSend('PATCH', `tenants/${id}`, patch); },
};
