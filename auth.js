// ============================================================
// auth.js — Login berbasis "Kode Toko" (tenant) + username/password.
// VERSI TER-HARDENING — ditulis ulang dengan referensi pola `piawai-app`
// (lihat SECURITY.md untuk daftar temuan lengkap). Perubahan utama
// dibanding versi sebelumnya:
//   [SECURITY] SELURUH pencocokan kredensial sekarang terjadi di server
//              (POST /public?view=login|register). Versi lama menarik
//              SEMUA baris `users` sebuah tenant ke browser lewat
//              db.allForTenant('users', ...) lalu membandingkan
//              `u.password === password` di JavaScript klien — siapa pun
//              yang tahu/menerka tenantId bisa membaca seluruh daftar
//              username+password toko itu. Endpoint itu sudah dihapus;
//              yang kembali dari server sekarang hanya token sesi +
//              data tampilan pengguna (tidak pernah password/hash).
//   [SECURITY] Captcha matematika kustom (soal diminta ke server,
//              jawaban diverifikasi di server) wajib untuk login &
//              registrasi — mencegah brute-force/spam otomatis pada
//              endpoint publik.
//   [SECURITY] Kredensial demo TIDAK LAGI ditampilkan di halaman login
//              publik (dulu ada di baris `lines` form Masuk) — itu sama
//              saja memasang kunci di pintu depan. Lihat schema.sql/README.
//
// Sesi disimpan di localStorage: token (posToken) TERPISAH dari data
// tampilan (posSession: { tenantId, tenantNama, userId, username, name,
// role }) — hanya token yang dikirim ke server (header Authorization),
// posSession murni untuk tampilan UI (menu, sapaan, dst.).
// ============================================================

/** Bangun HTML field captcha (raw, karena harus di dalam <form> yang sama
 *  supaya form.querySelector(...) di JS bisa menemukan hidden token-nya —
 *  lihat catatan `type:'raw'` di engine.js). `challenge` divalidasi format
 *  ketat sebelum disisipkan, walau sumbernya backend sendiri (bukan input
 *  pengguna), sebagai lapisan jaga-jaga tambahan. */
function mathCaptchaFieldsHtml(challenge, token) {
    const safeChallenge = /^\d{1,2} \+ \d{1,2} = \?$/.test(challenge) ? challenge : 'Soal captcha tidak valid';
    return `<input type="hidden" class="js-captcha-token" name="captchaToken" value="${escHtml(token || '')}">
        <div class="a-row">
            <label class="a-label">Captcha: ${escHtml(safeChallenge)}</label>
            <input type="number" class="js-captcha-answer" name="captchaAnswer" placeholder="Jawaban" required autocomplete="off">
        </div>`;
}

/** Ambil soal baru dari server dan render field captcha ke dalam form.
 *  Dipakai saat form pertama dibuka DAN setelah percobaan gagal (supaya
 *  token lama yang mungkin sudah kedaluwarsa/terpakai diganti yang baru). */
async function renderMathCaptcha(form) {
    const slot = form.querySelector('.js-captcha-slot');
    if (!slot) return;
    try {
        const { challenge, token } = await db.getCaptcha();
        slot.innerHTML = mathCaptchaFieldsHtml(challenge, token);
    } catch (e) {
        slot.innerHTML = `<div class="a-row"><span style="color:#c0392b">Gagal memuat captcha: ${escHtml(e.message)}</span></div>`;
    }
}

/** Ambil soal captcha awal untuk sebuah form baru dibuka. Dibungkus try/catch
 *  supaya server yang sedang bermasalah tidak membuat seluruh halaman Masuk/
 *  Daftar gagal dirender — pesan errornya ditampilkan di slot captcha saja. */
async function initialCaptchaFieldHtml() {
    try {
        const { challenge, token } = await db.getCaptcha();
        return `<div class="js-captcha-slot">${mathCaptchaFieldsHtml(challenge, token)}</div>`;
    } catch (e) {
        return `<div class="js-captcha-slot"><div class="a-row"><span style="color:#c0392b">Gagal memuat captcha: ${escHtml(e.message)}</span></div></div>`;
    }
}

/** Baca token + jawaban captcha yang sedang ditampilkan di form ini. */
function readCaptcha(form) {
    return {
        captchaToken: form.querySelector('.js-captcha-token')?.value || '',
        captchaAnswer: form.querySelector('.js-captcha-answer')?.value || '',
    };
}

const auth = {
    SESSION_KEY: 'posSession',
    TOKEN_KEY: 'posToken',
    SUPERADMIN_KODE: 'SUPERADMIN',

    // [SECURITY] Pengunci sisi-klien setelah beberapa kali gagal login.
    // Ini HANYA pelapis UX (mencegah klik cepat berkali-kali di browser)
    // — SAMA SEKALI BUKAN pertahanan terhadap brute-force sungguhan,
    // karena siapa pun bisa memanggil endpoint login backend langsung
    // tanpa lewat kode ini. Rate limiting/lockout NYATA ada di backend
    // (per IP dan per akun, lihat worker.js & SECURITY.md).
    LOGIN_LOCKOUT_KEY: 'posLoginAttempts',
    LOGIN_MAX_ATTEMPTS: 5,
    LOGIN_LOCKOUT_MS: 60_000,

    _loginAttemptState() {
        try { return JSON.parse(sessionStorage.getItem(this.LOGIN_LOCKOUT_KEY) || 'null') || { count: 0, until: 0 }; }
        catch (e) { return { count: 0, until: 0 }; }
    },
    _recordLoginFailure() {
        const s = this._loginAttemptState();
        s.count += 1;
        if (s.count >= this.LOGIN_MAX_ATTEMPTS) { s.until = Date.now() + this.LOGIN_LOCKOUT_MS; s.count = 0; }
        try { sessionStorage.setItem(this.LOGIN_LOCKOUT_KEY, JSON.stringify(s)); } catch (e) {}
    },
    _clearLoginFailures() {
        try { sessionStorage.removeItem(this.LOGIN_LOCKOUT_KEY); } catch (e) {}
    },
    _lockoutRemainingMs() {
        const s = this._loginAttemptState();
        return Math.max(0, s.until - Date.now());
    },

    /** Token sesi bertanda tangan dari server (dipakai db.js di header Authorization). */
    token() {
        try { return localStorage.getItem(this.TOKEN_KEY) || null; } catch (e) { return null; }
    },

    _saveSession(res) {
        localStorage.setItem(this.TOKEN_KEY, res.token);
        localStorage.setItem(this.SESSION_KEY, JSON.stringify(res.user));
    },

    currentUser() {
        try { return JSON.parse(localStorage.getItem(this.SESSION_KEY) || 'null'); }
        catch (e) { return null; }
    },

    isLoggedIn() { return !!this.currentUser(); },
    isSuperadmin() { return this.currentUser()?.role === 'superadmin'; },

    /**
     * Login — SELURUH pencocokan kredensial terjadi di server.
     * [SECURITY] Lihat catatan di kepala file: versi lama menarik semua
     * baris `users` ke browser dan membandingkan password di JS. Yang
     * kembali dari server sekarang hanya token sesi + data tampilan.
     */
    async login(kodeToko, username, password, captcha) {
        const kode = String(kodeToko || '').trim().toUpperCase();
        if (!kode || !username || !password) return 'Kode Toko, username, dan password wajib diisi.';
        try {
            const res = await db.login({ kodeToko: kode, username, password, ...captcha });
            this._saveSession(res);
            return null; // null = sukses
        } catch (e) {
            return e.message;
        }
    },

    /**
     * Registrasi mandiri toko baru — satu panggilan server (membuat baris
     * `tenants` + akun owner ber-hash + lokasi "Toko Utama" dalam satu
     * alur logis, setelah captcha diverifikasi). Frontend tidak lagi
     * membuat baris `users` sendiri lewat CRUD generik.
     */
    async register({ kodeToko, namaToko, alamat, telepon, ownerName, username, password, captchaToken, captchaAnswer }) {
        const kode = String(kodeToko || '').trim().toUpperCase();
        if (!kode || !namaToko || !ownerName || !username || !password) return 'Semua field bertanda * wajib diisi.';
        if (kode === this.SUPERADMIN_KODE) return 'Kode Toko tersebut tidak dapat dipakai.';
        if (password.length < 8) return 'Password minimal 8 karakter.';
        try {
            const res = await db.register({ kodeToko: kode, namaToko, alamat: alamat || '', telepon: telepon || '', ownerName, username, password, captchaToken, captchaAnswer });
            this._saveSession(res);
            return null;
        } catch (e) {
            return e.message;
        }
    },

    logout() {
        localStorage.removeItem(this.SESSION_KEY);
        localStorage.removeItem(this.TOKEN_KEY);
        if (typeof renderMenu === 'function') renderMenu();
        web.navigate('login');
    },

    /** Dipanggil dari renderMenu() (index.html) tiap kali menu digambar ulang.
     *  [SECURITY] user.name & user.tenantNama BISA berasal dari input
     *  pengguna (diisi saat registrasi mandiri) — WAJIB escHtml() sebelum
     *  masuk innerHTML, karena elemen ini dirender di HAMPIR SETIAP
     *  halaman (dulu titik XSS paling "produktif" di aplikasi ini). */
    renderAuthUI() {
        const slot = web.gebi('authSlot');
        if (!slot) return;
        const user = this.currentUser();
        slot.innerHTML = user
            ? `<span class="auth-chip">
                   <i class="di-person img-24"></i>
                   <span class="auth-name">${escHtml(user.name)}${user.role !== 'superadmin' ? ' &middot; ' + escHtml(user.tenantNama || '') : ''}</span>
                   <span class="badge auth-role">${escHtml(roleLabel(user.role))}</span>
               </span>
               <button class="slcBtn auth-logout" onclick="auth.logout()">Keluar</button>`
            : `<a href="javascript:void(0)" onclick="web.navigate('login')" class="auth-chip">
                   <i class="di-lock img-24"></i>
                   <span class="auth-name">Masuk</span>
               </a>`;
        if (typeof svg?.di === 'function') svg.di();
    },

    async handleLoginSubmit(form) {
        const remaining = this._lockoutRemainingMs();
        if (remaining > 0) {
            alert(`Terlalu banyak percobaan gagal. Coba lagi dalam ${Math.ceil(remaining / 1000)} detik.`);
            return;
        }

        // [SECURITY] captchaToken/captchaAnswer dikirim apa adanya ke
        // server — verifikasi yang SAH terjadi di backend (lihat
        // verifyMathCaptcha di worker.js), bukan di sini.
        const captcha = readCaptcha(form);
        if (!captcha.captchaToken || !captcha.captchaAnswer) { alert('Mohon isi jawaban captcha terlebih dahulu.'); return; }

        const kodeToko = form.querySelector('[name="kodeToko"]').value;
        const username = form.querySelector('[name="username"]').value.trim();
        const password = form.querySelector('[name="password"]').value;

        const btn = form.querySelector('button[type="submit"]');
        if (btn) { btn.disabled = true; btn.textContent = 'Memproses...'; }
        const err = await this.login(kodeToko, username, password, captcha).catch(e => e.message);
        if (btn) { btn.disabled = false; btn.textContent = 'Masuk'; }
        await renderMathCaptcha(form); // soal lama sudah terpakai (atau salah) -> ganti yang baru

        if (err) { this._recordLoginFailure(); alert(err); return; }
        this._clearLoginFailures();
        if (typeof renderMenu === 'function') renderMenu();
        web.navigate(this.isSuperadmin() ? 'tenant' : 'dashboard');
    },

    async handleRegisterSubmit(form) {
        const captcha = readCaptcha(form);
        if (!captcha.captchaToken || !captcha.captchaAnswer) { alert('Mohon isi jawaban captcha terlebih dahulu.'); return; }

        const val = (name) => form.querySelector(`[name="${name}"]`)?.value.trim() || '';
        const payload = {
            kodeToko: val('kodeToko'), namaToko: val('namaToko'), alamat: val('alamat'),
            telepon: val('telepon'), ownerName: val('ownerName'), username: val('username'),
            password: form.querySelector('[name="password"]').value,
            ...captcha,
        };
        const btn = form.querySelector('button[type="submit"]');
        if (btn) { btn.disabled = true; btn.textContent = 'Mendaftarkan...'; }
        const err = await this.register(payload).catch(e => e.message);
        if (btn) { btn.disabled = false; btn.textContent = 'Daftar & Mulai'; }
        await renderMathCaptcha(form);

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
web.resolveLogin = async function () {
    if (auth.isLoggedIn()) {
        return [{ section: 'titleHero', title: 'Anda Sudah Masuk',
                   description: `Masuk sebagai <strong>${escHtml(auth.currentUser().name)}</strong>.` }];
    }
    return [
        { section: 'titleHero', title: 'Masuk ke Toko Anda', description: 'Masukkan Kode Toko, username, dan password.' },
        {
            section: 'articleFull',
            subtitle: 'Form Masuk',
            fields: [
                { type: 'text', name: 'kodeToko', label: 'Kode Toko', placeholder: 'mis. TOKO001', required: true, autocomplete: 'username' },
                { type: 'text', name: 'username', label: 'Username', required: true, autocomplete: 'username' },
                { type: 'password', name: 'password', label: 'Password', required: true, autocomplete: 'current-password' },
                { type: 'raw', html: await initialCaptchaFieldHtml() },
            ],
            submitText: 'Masuk',
            onSubmit: 'event.preventDefault(); auth.handleLoginSubmit(this);',
            lines: [
                'form:',
                'link:Belum punya toko? Daftar di sini:register',
                // [SECURITY] Kredensial demo SENGAJA tidak lagi ditampilkan
                // di halaman login publik — itu sama saja memasang kunci
                // di pintu. Akun demo ada di schema.sql/README, bukan di UI.
            ],
        },
    ];
};

web.routes.register = 'resolveRegister';
web.resolveRegister = async function () {
    if (auth.isLoggedIn()) return web.resolveLogin();
    return [
        { section: 'titleHero', title: 'Daftarkan Toko Baru', description: 'Buat akun toko Anda sendiri dalam satu langkah.' },
        {
            section: 'articleFull',
            subtitle: 'Form Registrasi Toko',
            fields: [
                { type: 'text', name: 'kodeToko', label: 'Kode Toko', placeholder: 'mis. TOKO002', required: true },
                { type: 'text', name: 'namaToko', label: 'Nama Toko', required: true, maxlength: 80 },
                { type: 'text', name: 'alamat', label: 'Alamat', maxlength: 200 },
                { type: 'text', name: 'telepon', label: 'Telepon', maxlength: 30 },
                { type: 'text', name: 'ownerName', label: 'Nama Pemilik', required: true, maxlength: 80 },
                { type: 'text', name: 'username', label: 'Username Pemilik', required: true, autocomplete: 'username' },
                { type: 'password', name: 'password', label: 'Password (min. 8 karakter)', required: true, autocomplete: 'new-password' },
                { type: 'raw', html: await initialCaptchaFieldHtml() },
            ],
            submitText: 'Daftar & Mulai',
            onSubmit: 'event.preventDefault(); auth.handleRegisterSubmit(this);',
            lines: ['form:', 'link:Sudah punya akun? Masuk di sini:login'],
        },
    ];
};
