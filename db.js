// ============================================================
// db.js — Lapisan akses data (fetch ke Worker API backend) + auto tenant-scoping.
// VERSI TER-HARDENING/DIOPTIMALKAN — ditulis ulang dengan referensi
// pola `piawai-app` (lihat SECURITY.md untuk daftar temuan lengkap).
// ============================================================
// Perubahan dibanding versi sebelumnya:
//   [SECURITY] Semua parameter (table, id) sekarang dikirim lewat QUERY
//              STRING ke SATU endpoint `/api` (bukan path segment
//              `/api/table/id`), konsisten dengan worker.js yang baru.
//              tenantId TIDAK PERNAH dikirim dari klien lagi — backend
//              menurunkannya sendiri dari token sesi (lihat authHeaders()).
//   [SECURITY] allForTenant()/insertForTenant() DIHAPUS TOTAL. Dulu
//              dipakai auth.js untuk menarik SELURUH tabel `users`
//              (termasuk password) ke browser lalu mencocokkan di JS.
//              Backend sekarang memblokir tabel `users` dari /api
//              sepenuhnya; login & registrasi pindah ke endpoint server
//              (lihat auth.login/auth.register -> db.login/db.register).
//   [PERF]     Cache in-memory per tabel (TTL 30 detik), dibuang
//              otomatis tiap ada insert/update/remove — banyak resolver
//              memanggil tabel yang sama berdekatan (menu, dashboard,
//              dst.), tanpa cache tiap navigasi menunggu fetch ulang.
// ============================================================

// GANTI dengan URL hasil `wrangler deploy` di repo pos-api, tanpa slash
// di akhir. Contoh: 'https://pos-api.namaakun.workers.dev'
const API_BASE = 'https://pos-api.sismadi.workers.dev';

const SCOPED_TABLES = new Set([
    'produk', 'lokasi', 'lokasi_produk', 'kontak',
    'distribusi', 'distribusi_produk',
    'transaksi', 'transaksi_produk',
    'payment',
    'akun', 'jurnal', 'jurnal_detail',
]); // `users` tidak lagi diakses lewat /api sama sekali

// ============================================================
// [SECURITY] Token sesi. Backend (pos-api) menurunkan tenantId & role
// dari token bertanda tangan ini, BUKAN dari query string — jadi
// mengubah tenantId di localStorage tidak lagi membuka data toko lain.
// ============================================================
function authHeaders() {
    const t = (typeof auth !== 'undefined') ? auth.token() : null;
    return t ? { Authorization: `Bearer ${t}` } : {};
}

/** 401 = sesi habis/dicabut server -> bersihkan sesi lokal & kembali ke login. */
function handleUnauthorized() {
    if (typeof auth !== 'undefined') {
        try { localStorage.removeItem(auth.SESSION_KEY); } catch (e) {}
    }
    if (typeof web !== 'undefined' && typeof web.navigate === 'function') web.navigate('login');
}

/** Bangun query string dari objek {key: value}, buang key yang kosong/undefined. */
function qs(params) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params || {})) {
        if (v !== undefined && v !== null && v !== '') sp.set(k, v);
    }
    const s = sp.toString();
    return s ? `?${s}` : '';
}

async function apiGet(params) {
    const res = await fetch(`${API_BASE}/api${qs(params)}`, { headers: authHeaders() });
    if (res.status === 401) { handleUnauthorized(); throw new Error('Sesi berakhir, silakan masuk kembali.'); }
    if (!res.ok) {
        let msg = `GET /api gagal (${res.status})`;
        try { const j = await res.json(); if (j?.error) msg = j.error; } catch (e) {}
        throw new Error(msg);
    }
    return res.json();
}

async function apiSend(method, params, body) {
    const res = await fetch(`${API_BASE}/api${qs(params)}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) { handleUnauthorized(); throw new Error('Sesi berakhir, silakan masuk kembali.'); }
    if (res.status === 404) return null;
    if (!res.ok) {
        let msg = `${method} /api gagal (${res.status})`;
        try { const j = await res.json(); if (j?.error) msg = j.error; } catch (e) {}
        throw new Error(msg);
    }
    return res.json();
}

/** Fetch ke endpoint /public (login, registrasi, captcha — tidak butuh sesi). */
async function apiPublicGet(params) {
    const res = await fetch(`${API_BASE}/public${qs(params)}`);
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.error || `GET /public gagal (${res.status})`);
    return body;
}
async function apiPublicSend(method, params, body) {
    const res = await fetch(`${API_BASE}/public${qs(params)}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const resBody = await res.json().catch(() => null);
    if (!res.ok) throw new Error(resBody?.error || `${method} /public gagal (${res.status})`);
    return resBody;
}

// ============================================================
// [PERF] Cache in-memory per tabel — db.all() dipanggil berulang kali
// oleh banyak resolver (menu, dashboard, halaman transaksional, dst.)
// untuk tabel yang sama dalam waktu berdekatan. Cache ini HANYA hidup
// selama sesi tab (di memori, bukan localStorage) dan otomatis dibuang
// lewat invalidateTable() setiap ada insert/update/remove — jadi tidak
// pernah menampilkan data basi setelah CRUD milik pengguna sendiri.
// ============================================================
const _tableCache = new Map(); // key: "table:tenantId" -> { data, ts }
const CACHE_TTL_MS = 30_000; // jaga-jaga kalau data berubah dari sesi/tab lain

function cacheKey(table, tenantId) {
    return tenantId ? `${table}:${tenantId}` : table;
}
function invalidateTable(table, tenantId) {
    if (tenantId !== undefined) { _tableCache.delete(cacheKey(table, tenantId)); return; }
    for (const key of _tableCache.keys()) {
        if (key === table || key.startsWith(`${table}:`)) _tableCache.delete(key);
    }
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
        const params = { table };
        if (SCOPED_TABLES.has(table)) params.tenantId = requireTenant(); // dipakai HANYA sebagai kunci cache lokal, server tetap pakai token

        const key = cacheKey(table, params.tenantId);
        const hit = _tableCache.get(key);
        if (hit && (Date.now() - hit.ts) < CACHE_TTL_MS) return hit.data;

        const data = await apiGet({ table }); // tenantId TIDAK dikirim ke server (lihat catatan di atas)
        _tableCache.set(key, { data, ts: Date.now() });
        return data;
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
        const tenantId = SCOPED_TABLES.has(table) ? requireTenant() : undefined;
        const result = await apiSend('POST', { table }, row);
        invalidateTable(table, tenantId);
        return result;
    },

    async update(table, id, patch) {
        const tenantId = SCOPED_TABLES.has(table) ? requireTenant() : undefined;
        const result = await apiSend('PATCH', { table, id }, patch);
        invalidateTable(table, tenantId);
        return result;
    },

    async remove(table, id) {
        const tenantId = SCOPED_TABLES.has(table) ? requireTenant() : undefined;
        await apiSend('DELETE', { table, id });
        invalidateTable(table, tenantId);
        return true;
    },

    async upsertBy(table, matchFn, row) {
        const rows = await this.all(table);
        const existing = rows.find(matchFn);
        if (!existing) return this.insert(table, row);
        return this.update(table, existing.id, row);
    },

    // --- Tabel `tenants` sendiri TIDAK di-scope (global, khusus superadmin) ---
    async allTenants() {
        const key = cacheKey('tenants');
        const hit = _tableCache.get(key);
        if (hit && (Date.now() - hit.ts) < CACHE_TTL_MS) return hit.data;
        const data = await apiGet({ table: 'tenants' });
        _tableCache.set(key, { data, ts: Date.now() });
        return data;
    },
    /** Superadmin membuat tenant BARU + akun owner-nya sekaligus (password
     *  di-hash di server, lihat handleTenantsTable di worker.js). */
    async insertTenant(payload) {
        const result = await apiSend('POST', { table: 'tenants' }, payload);
        invalidateTable('tenants');
        return result;
    },
    async updateTenant(id, patch) {
        const result = await apiSend('PATCH', { table: 'tenants', id }, patch);
        invalidateTable('tenants');
        return result;
    },

    // --- Autentikasi (diproses SEPENUHNYA di server) ---
    async login(payload) { return apiPublicSend('POST', { view: 'login' }, payload); },
    async register(payload) { return apiPublicSend('POST', { view: 'register' }, payload); },

    // --- Captcha matematika (lihat auth.js) — soal baru tiap dipanggil. ---
    async getCaptcha() { return apiPublicGet({ view: 'captcha' }); },
};
