// ============================================================
// auth.js — Login berbasis "Kode Toko" (tenant) + username/password.
// ============================================================
// Sesi disimpan di localStorage (key: posSession): { tenantId, tenantNama,
// userId, username, name, role }. Superadmin adalah tenant khusus
// (kodeToko 'SUPERADMIN', lihat seed di schema.sql) — dengan begini alur
// login TETAP SATU POLA untuk semua peran (owner/kasir/gudang/superadmin),
// tidak perlu percabangan logika terpisah di worker.js maupun db.js.
//
// Class CSS yang dipakai di sini (auth-chip, auth-name, auth-role, badge)
// SUDAH tersedia di style.css (lihat blok "AUTH + DASHBOARD PATCH").
// ============================================================
const auth = {
    SESSION_KEY: 'posSession',
    SUPERADMIN_KODE: 'SUPERADMIN',

    currentUser() {
        try { return JSON.parse(localStorage.getItem(this.SESSION_KEY) || 'null'); }
        catch (e) { return null; }
    },

    isLoggedIn() { return !!this.currentUser(); },
    isSuperadmin() { return this.currentUser()?.role === 'superadmin'; },

    /** Login: cari tenant lewat kodeToko, lalu cocokkan username/password DI DALAM tenant tsb. */
    async login(kodeToko, username, password) {
        const kode = String(kodeToko || '').trim().toUpperCase();
        if (!kode || !username || !password) return 'Kode Toko, username, dan password wajib diisi.';

        const tenants = await db.allTenants();
        const tenant = tenants.find(t => t.kodeToko.toUpperCase() === kode);
        if (!tenant) return 'Kode Toko tidak ditemukan.';
        if (tenant.status === 'nonaktif') return 'Akun toko ini sedang dinonaktifkan. Hubungi superadmin.';

        const users = await db.allForTenant('users', tenant.id);
        const user = users.find(u => u.username === username && u.password === password);
        if (!user) return 'Username atau password salah.';

        localStorage.setItem(this.SESSION_KEY, JSON.stringify({
            tenantId: tenant.id, tenantNama: tenant.nama,
            userId: user.id, username: user.username, name: user.name, role: user.role,
        }));
        return null; // null = sukses
    },

    /**
     * Registrasi mandiri toko baru (self-service tenant + akun owner).
     * Mengembalikan string error, atau null kalau berhasil (langsung login).
     */
    async register({ kodeToko, namaToko, alamat, telepon, ownerName, username, password }) {
        const kode = String(kodeToko || '').trim().toUpperCase();
        if (!kode || !namaToko || !ownerName || !username || !password) return 'Semua field bertanda * wajib diisi.';
        if (kode === this.SUPERADMIN_KODE) return 'Kode Toko tersebut tidak dapat dipakai.';
        if (password.length < 6) return 'Password minimal 6 karakter.';

        const tenants = await db.allTenants();
        if (tenants.some(t => t.kodeToko.toUpperCase() === kode)) return 'Kode Toko sudah dipakai, gunakan kode lain.';

        const tenant = await db.insertTenant({
            kodeToko: kode, nama: namaToko, alamat: alamat || '', telepon: telepon || '',
            status: 'aktif', createdAt: new Date().toISOString(),
        });

        await db.insertForTenant('users', tenant.id, {
            username, password, name: ownerName, role: 'owner', createdAt: new Date().toISOString(),
        });

        // Lokasi "Toko Utama" dibuat otomatis supaya toko baru langsung punya tempat menyimpan stok.
        await db.insertForTenant('lokasi', tenant.id, {
            nama: 'Toko Utama', tipe: 'toko', alamat: alamat || '', createdAt: new Date().toISOString(),
        });

        return this.login(kode, username, password);
    },

    logout() {
        localStorage.removeItem(this.SESSION_KEY);
        if (typeof renderMenu === 'function') renderMenu();
        web.navigate('login');
    },

    /** Dipanggil dari renderMenu() (index.html) tiap kali menu digambar ulang. */
    renderAuthUI() {
        const slot = web.gebi('authSlot');
        if (!slot) return;
        const user = this.currentUser();
        slot.innerHTML = user
            ? `<span class="auth-chip">
                   <i class="di-person img-24"></i>
                   <span class="auth-name">${user.name}${user.role !== 'superadmin' ? ' &middot; ' + (user.tenantNama || '') : ''}</span>
                   <span class="badge auth-role">${roleLabel(user.role)}</span>
               </span>
               <button class="slcBtn auth-logout" onclick="auth.logout()">Keluar</button>`
            : `<a href="javascript:void(0)" onclick="web.navigate('login')" class="auth-chip">
                   <i class="di-lock img-24"></i>
                   <span class="auth-name">Masuk</span>
               </a>`;
        if (typeof svg?.di === 'function') svg.di();
    },

    async handleLoginSubmit(form) {
        const kodeToko = form.querySelector('[name="kodeToko"]').value;
        const username = form.querySelector('[name="username"]').value.trim();
        const password = form.querySelector('[name="password"]').value;

        const btn = form.querySelector('button[type="submit"]');
        if (btn) { btn.disabled = true; btn.textContent = 'Memproses...'; }
        const err = await this.login(kodeToko, username, password).catch(e => e.message);
        if (btn) { btn.disabled = false; btn.textContent = 'Masuk'; }

        if (err) { alert(err); return; }
        if (typeof renderMenu === 'function') renderMenu();
        web.navigate(this.isSuperadmin() ? 'tenant' : 'dashboard');
    },

    async handleRegisterSubmit(form) {
        const val = (name) => form.querySelector(`[name="${name}"]`)?.value.trim() || '';
        const payload = {
            kodeToko: val('kodeToko'), namaToko: val('namaToko'), alamat: val('alamat'),
            telepon: val('telepon'), ownerName: val('ownerName'), username: val('username'),
            password: form.querySelector('[name="password"]').value,
        };
        const btn = form.querySelector('button[type="submit"]');
        if (btn) { btn.disabled = true; btn.textContent = 'Mendaftarkan...'; }
        const err = await this.register(payload).catch(e => e.message);
        if (btn) { btn.disabled = false; btn.textContent = 'Daftar & Mulai'; }

        if (err) { alert(err); return; }
        alert(`Toko "${payload.namaToko}" berhasil dibuat. Selamat datang!`);
        if (typeof renderMenu === 'function') renderMenu();
        web.navigate('dashboard');
    },
};

function roleLabel(role) {
    return { superadmin: 'Superadmin', owner: 'Pemilik', kasir: 'Kasir', gudang: 'Gudang' }[role] || role;
}

/** Guard: dipanggil di awal resolver halaman yang butuh login (lihat pages/*.js). */
function requireLogin(allowedRoles) {
    const user = auth.currentUser();
    if (!user) {
        return [{ section: 'titleHero', title: 'Perlu Masuk',
                   description: `Silakan <a href="javascript:void(0)" onclick="web.navigate(&#39;login&#39;)">masuk</a> terlebih dahulu untuk mengakses halaman ini.` }];
    }
    if (allowedRoles && !allowedRoles.includes(user.role)) {
        return [{ section: 'titleHero', title: 'Akses Ditolak',
                   description: 'Peran akun Anda tidak memiliki izin untuk membuka halaman ini.' }];
    }
    return null; // null = boleh lanjut
}

web.routes.login = 'resolveLogin';
web.resolveLogin = function () {
    if (auth.isLoggedIn()) {
        return [{ section: 'titleHero', title: 'Anda Sudah Masuk',
                   description: `Masuk sebagai <strong>${auth.currentUser().name}</strong>.` }];
    }
    return [
        { section: 'titleHero', title: 'Masuk ke Toko Anda', description: 'Masukkan Kode Toko, username, dan password.' },
        {
            section: 'articleFull',
            subtitle: 'Form Masuk',
            fields: [
                { type: 'text', name: 'kodeToko', label: 'Kode Toko', placeholder: 'mis. TOKO001', required: true },
                { type: 'text', name: 'username', label: 'Username', required: true },
                { type: 'password', name: 'password', label: 'Password', required: true },
            ],
            submitText: 'Masuk',
            onSubmit: 'event.preventDefault(); auth.handleLoginSubmit(this);',
            lines: [
                'form:',
                'link:Belum punya toko? Daftar di sini:register',
                '---',
                '**Demo:** Kode Toko `TOKO001`, username `owner` / password `owner123`.',
                'Superadmin: Kode Toko `SUPERADMIN`, username `superadmin` / password `super123`.',
            ],
        },
    ];
};

web.routes.register = 'resolveRegister';
web.resolveRegister = function () {
    if (auth.isLoggedIn()) return web.resolveLogin();
    return [
        { section: 'titleHero', title: 'Daftarkan Toko Baru', description: 'Buat akun toko Anda sendiri dalam satu langkah.' },
        {
            section: 'articleFull',
            subtitle: 'Form Registrasi Toko',
            fields: [
                { type: 'text', name: 'kodeToko', label: 'Kode Toko', placeholder: 'mis. TOKO002', required: true },
                { type: 'text', name: 'namaToko', label: 'Nama Toko', required: true },
                { type: 'text', name: 'alamat', label: 'Alamat' },
                { type: 'text', name: 'telepon', label: 'Telepon' },
                { type: 'text', name: 'ownerName', label: 'Nama Pemilik', required: true },
                { type: 'text', name: 'username', label: 'Username Pemilik', required: true },
                { type: 'password', name: 'password', label: 'Password (min. 6 karakter)', required: true },
            ],
            submitText: 'Daftar & Mulai',
            onSubmit: 'event.preventDefault(); auth.handleRegisterSubmit(this);',
            lines: ['form:', 'link:Sudah punya akun? Masuk di sini:login'],
        },
    ];
};
