// ============================================================
// engine.js — Mesin render generik untuk POS Multi-Tenant.
// VERSI TER-HARDENING/DIOPTIMALKAN — ditulis ulang dengan referensi
// pola `piawai-app` (lihat SECURITY.md untuk daftar temuan lengkap).
// Perubahan utama dibanding versi sebelumnya:
//   [SECURITY] escHtml() terpusat + renderTable()/genericForm() escape
//              nilai secara default (opt-out lewat opts.rawKeys, BUKAN
//              opt-in) — dulu SEMUA nilai (termasuk nama produk/kontak/
//              lokasi/akun yang diketik pengguna) dirender mentah lewat
//              innerHTML, itu stored XSS di hampir setiap halaman.
//   [PERF]     loadPageScripts() di dataset.js sekarang paralel (lihat
//              file itu), render pertama tidak menunggu event 'load'
//              penuh, progress bar navigasi + guard anti race-condition
//              di navigate() (klik cepat antar-halaman tidak lagi
//              "kedip" balik ke halaman sebelumnya).
// ============================================================

const web = {
    routes: {},   // diisi oleh masing-masing pages/*.js, mis. web.routes.produk = 'resolveProduk'

    gebi: (id) => document.getElementById(id),

    // ------------------------------------------------------------
    // FORM DRAWER — panel geser dari kanan, dipakai ulang oleh SEMUA
    // form tambah/edit (produk, kontak, lokasi, distribusi, transaksi,
    // tenant, jurnal). Markup statis ada di index.html
    // (#formDrawerOverlay/#formDrawerPanel).
    // ------------------------------------------------------------
    openDrawer: function (cfg) {
        const overlay = this.gebi('formDrawerOverlay');
        const panel   = this.gebi('formDrawerPanel');
        const titleEl = this.gebi('formDrawerTitle');
        const bodyEl  = this.gebi('formDrawerBody');
        if (!overlay || !panel || !bodyEl || !cfg) return;

        titleEl.textContent = cfg.title || cfg.subtitle || 'Form';
        bodyEl.innerHTML = cfg.bodyHtml !== undefined ? cfg.bodyHtml : components.genericForm(cfg);

        overlay.classList.add('open');
        panel.classList.add('open');
        document.body.classList.add('drawer-lock');
        if (typeof svg?.di === 'function') svg.di();
    },

    closeDrawer: function () {
        this.gebi('formDrawerOverlay')?.classList.remove('open');
        this.gebi('formDrawerPanel')?.classList.remove('open');
        document.body.classList.remove('drawer-lock');
    },

    /** Jembatan generik: buka drawer langsung dari config form { title, fields, onSubmit, submitText }. */
    openFormFromPage: function (cfg, opts = {}) {
        if (!cfg || !cfg.fields) { alert(opts.title || 'Tidak dapat membuka form'); return; }
        this.openDrawer({ ...cfg, title: opts.title || cfg.title || cfg.subtitle });
    },

    // ------------------------------------------------------------
    // ROUTING — slug -> resolver di `web.routes`, slug yang tidak
    // terdaftar otomatis dibaca dari `pages[slug]` statis (lihat
    // resolveContent, dataset.js). Semua resolver di-await karena
    // sebagian besar mengambil data lewat db.js (fetch async ke Worker API).
    // ------------------------------------------------------------
    navigate: async function (slug) {
        this.closeDrawer();

        // [PERF] Guard anti race-condition: klik cepat antar-halaman bisa
        // membuat fetch dari navigasi LAMA baru selesai SETELAH navigasi
        // BARU sudah dimulai, lalu menimpa konten yang sudah benar dengan
        // konten dari rute lama ("kedip" balik ke halaman sebelumnya).
        // Tiap panggilan navigate() dapat nomor urut sendiri; hanya
        // panggilan TERBARU yang boleh menulis ke DOM/history/title.
        const mySeq = ++this._navSeq;
        web.startProgress();

        const queryString = window.location.search.substring(1);
        const currentPath = slug || queryString || 'home';
        const [targetSlug, subParam] = currentPath.split('/');

        let pageData = [];
        const resolverName = this.routes[targetSlug];
        const resolverFn = this[resolverName] || window[resolverName];

        try {
            if (typeof resolverFn === 'function') {
                pageData = await Promise.resolve(resolverFn.call(this, subParam, targetSlug));
            } else {
                pageData = this.resolveContent(targetSlug, subParam);
            }
        } catch (err) {
            console.error(err);
            pageData = [{ section: 'titleHero', title: 'Terjadi Kesalahan', description: escHtml(err.message) }];
        }

        // Navigasi lain sudah dimulai selagi resolver di atas menunggu
        // fetch — hasil ini sudah basi, jangan sentuh DOM/history/title.
        if (mySeq !== this._navSeq) return false;

        await ui.render('content', pageData);
        web.finishProgress();

        if (slug !== undefined) {
            window.history.pushState({ path: currentPath }, '', `?${currentPath}`);
        }
        document.title = `POS | ${targetSlug.toUpperCase()}`;
        window.scrollTo(0, 0);
        if (typeof svg?.di === 'function') svg.di();

        web.gebi('navLinks')?.classList.remove('active');
        document.querySelectorAll('.nav-parent.open').forEach(el => el.classList.remove('open'));
        return false;
    },

    _navSeq: 0,

    // ------------------------------------------------------------
    // [PERF] PROGRESS BAR — garis tipis di atas halaman selama navigasi
    // menunggu fetch data, supaya jeda terasa "sedang memuat" alih-alih
    // diam/kedip. Murni kosmetik, tidak menahan render apa pun.
    // ------------------------------------------------------------
    _progressTimer: null,
    startProgress: function () {
        const bar = this.gebi('navProgress');
        if (!bar) return;
        clearTimeout(this._progressTimer);
        bar.classList.remove('done');
        bar.style.transition = 'none';
        bar.style.width = '0%';
        void bar.offsetWidth; // paksa reflow supaya transisi berikutnya benar-benar animasi
        bar.style.transition = '';
        bar.classList.add('active');
        requestAnimationFrame(() => { bar.style.width = '80%'; });
    },
    finishProgress: function () {
        const bar = this.gebi('navProgress');
        if (!bar) return;
        bar.style.width = '100%';
        this._progressTimer = setTimeout(() => {
            bar.classList.remove('active');
            bar.classList.add('done');
        }, 150);
    },

    /** Buka/tutup submenu dropdown (dipakai lewat klik, terutama di mobile;
     *  di desktop dropdown juga terbuka lewat hover via CSS — lihat style.css). */
    toggleSubmenu: function (labelEl) {
        const parent = labelEl.closest('.nav-parent');
        if (!parent) return;
        const wasOpen = parent.classList.contains('open');
        document.querySelectorAll('.nav-parent.open').forEach(el => el.classList.remove('open'));
        if (!wasOpen) parent.classList.add('open');
    },

    /** Halaman statis biasa: langsung baca pages[slug] (lihat dataset.js). */
    resolveContent: function (category, subId) {
        const fullData = pages[category] || pages['home'];
        if (!Array.isArray(fullData)) return fullData;

        if (subId) {
            const cleanId = subId.split('?')[0];
            const subContent = fullData.find(item => item.id === cleanId);
            if (subContent) return [subContent];
            return [{ section: 'titleHero', title: 'Konten Tidak Ditemukan',
                      description: `ID <strong>${escHtml(cleanId)}</strong> tidak tersedia.` }];
        }
        return fullData.filter(item => !item.id);
    },
};

// ============================================================
// [SECURITY] Escaping HTML terpusat.
// ------------------------------------------------------------
// Halaman-halaman POS (produk, kontak, lokasi, akun, jurnal, dst.)
// merender BANYAK nilai yang berasal dari input pengguna (nama produk,
// nama kontak, alamat, keterangan jurnal, dst.) lewat template string ke
// innerHTML. Tanpa escHtml(), nilai seperti `<img src=x onerror=...>`
// akan DIEKSEKUSI sebagai HTML, bukan ditampilkan sebagai teks (stored
// XSS). renderTable() & genericForm() di bawah escape nilai SECARA
// DEFAULT; kolom yang memang sengaja berisi HTML mentah (badge status,
// tombol Aksi) harus didaftarkan lewat opts.rawKeys — eksplisit sebagai
// pengecualian, bukan sebaliknya.
// ============================================================
function escHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

// ============================================================
// COMPONENTS — komponen render
// ============================================================
const components = {

    lineRenderer: (lines = [], context = {}) => {
        const data = Array.isArray(lines) ? lines : [];
        let inCodeBlock = false;

        const handlers = {
            'form:': (val) => {
                if (val) {
                    try { const inlineCtx = JSON.parse(val); return components.genericForm(inlineCtx); }
                    catch (e) { return components.genericForm(context); }
                }
                return components.genericForm(context);
            },
            'link:': (val) => {
                const parts = val.split(':');
                return `<a href="javascript:void(0)" onclick="web.navigate('${escHtml(parts.slice(1).join(':'))}')" class="inline-link">${escHtml(parts[0])} &raquo;</a>`;
            },
            'skill:': (val) => {
                const [percent, label, text] = val.split(':');
                return `<div class="skill-item">
                    <div class="skill-info"><strong>${escHtml(label)}</strong> ${escHtml(text || '')} <small>(${escHtml(percent)})</small></div>
                    <div class="skill-track"><div class="skill-fill" style="width:${escHtml(percent)}"></div></div>
                </div>`;
            },
            'card:': (val) => {
                const [title, content] = val.split(':');
                return `<div class="info-card"><strong>${escHtml(title)}</strong><p>${escHtml(content)}</p></div>`;
            },
            'table:': (val) => {
                let dataTable = null;
                if (val) {
                    if (context[val] && Array.isArray(context[val])) dataTable = context[val];
                    else { try { const parsed = JSON.parse(val); if (Array.isArray(parsed)) dataTable = parsed; } catch (e) { return `<div class="info-card">⚠ Format tabel salah</div>`; } }
                }
                if (!dataTable?.length) return context.emptyText ? `<div class="info-card">${context.emptyText}</div>` : '';
                return components.renderTable(dataTable, context.tableOpts || {});
            },
            'badge:': (val) => `<span class="badge">${escHtml(val)}</span>`,
            '### ': (val) => `<h3>${escHtml(val)}</h3>`,
            '## ':  (val) => `<h2>${escHtml(val)}</h2>`,
            '---':  () => '<hr>',
        };

        const out = [];
        let cardBuffer = [];
        const flushCards = () => {
            if (!cardBuffer.length) return;
            out.push(`<div class="info-card-grid">${cardBuffer.join('')}</div>`);
            cardBuffer = [];
        };

        for (const raw of data) {
            const line = String(raw ?? '');
            if (line.startsWith('```')) { inCodeBlock = !inCodeBlock; continue; }
            if (inCodeBlock) { out.push(`<pre><code>${escHtml(line)}</code></pre>`); continue; }

            let matched = false;
            for (const [prefix, handler] of Object.entries(handlers)) {
                if (line.startsWith(prefix)) {
                    const rendered = handler(line.slice(prefix.length));
                    if (prefix === 'card:') { cardBuffer.push(rendered); }
                    else { flushCards(); out.push(rendered); }
                    matched = true;
                    break;
                }
            }
            if (!matched) {
                flushCards();
                out.push(line.trim() === '' ? '' : `<p>${line}</p>`);
            }
        }
        flushCards();
        return out.join('');
    },

    /** Form generik dari config { fields, onSubmit, submitText, wrapClass, noSubmitBtn }.
     *  fields[]: { type, name, label, value, placeholder, required, options, rows, step, maxlength }
     *  type 'raw' -> f.html disisipkan APA ADANYA (HARUS HTML yang sudah
     *  dirakit/dipercaya oleh developer, BUKAN nilai dari pengguna). */
    genericForm: (ctx) => {
        const fields = (ctx.fields || []).map(f => {
            if (f.type === 'raw') return f.html || '';

            const fid  = f.id ? `id="${escHtml(f.id)}"` : '';
            // [SECURITY] f.value SERING berasal dari data tersimpan yang
            // aslinya diketik pengguna (mis. nama produk saat form Edit
            // dibuka). Tanpa escHtml(), nilai seperti `"><script>...`
            // bisa keluar dari atribut value="..." dan menyuntik HTML/JS
            // baru ke form (stored XSS yang muncul lagi tiap form dibuka).
            const fval = escHtml(f.value !== undefined && f.value !== null ? String(f.value) : '');
            const req  = f.required ? 'required' : '';
            const ph   = f.placeholder ? `placeholder="${escHtml(f.placeholder)}"` : '';
            const maxlen = f.maxlength ? `maxlength="${Number(f.maxlength)}"` : '';
            const fname = f.name ? `name="${escHtml(f.name)}"` : '';

            if (f.type === 'hidden') return `<input type="hidden" ${fid} ${fname} value="${fval}">`;

            const starMark = f.required ? ' <span style="color:var(--aColor,#DF8C43)">*</span>' : '';
            const label = f.label ? `<label class="a-label">${escHtml(f.label)}${starMark}</label>` : '';

            let input;
            if (f.type === 'select') {
                const opts = (f.options || []).map(o => {
                    const v   = typeof o === 'object' ? o.value : o;
                    const l   = typeof o === 'object' ? o.label : o;
                    const sel = String(fval) === escHtml(String(v)) ? 'selected' : '';
                    return `<option value="${escHtml(v)}" ${sel}>${escHtml(l)}</option>`;
                }).join('');
                input = `<select ${fid} ${fname} ${req}><option value="">— pilih —</option>${opts}</select>`;
            } else if (f.type === 'textarea') {
                input = `<textarea ${fid} ${fname} rows="${f.rows || 3}" ${ph} ${req} ${maxlen}>${fval}</textarea>`;
            } else {
                const step = f.type === 'number' ? `step="${f.step || 'any'}"` : '';
                input = `<input type="${f.type || 'text'}" ${fid} ${fname} value="${fval}" ${ph} ${req} ${step} ${maxlen}>`;
            }
            return `<div class="a-row">${label}${input}</div>`;
        }).join('');

        const onSubmit  = ctx.onSubmit || "event.preventDefault();";
        const submitBtn = ctx.noSubmitBtn ? '' : `<button type="submit" class="slcBtn">${escHtml(ctx.submitText || 'Simpan')}</button>`;

        return `<form class="${ctx.wrapClass || 'dynamic-form'}" onsubmit="${onSubmit}">
            ${fields}
            ${submitBtn}
        </form>`;
    },

    titleHero: (d) => `
        <div class="row page">
            <div class="artikel">
                <h1>${d.title}</h1>
                ${d.description ? `<p>${d.description}</p>` : ''}
            </div>
        </div>`,

    hero: (d) => {
        const media = d.img
            ? `<img src="${d.img}" alt="${d.title}" class="img-hero">`
            : d.imgClass
                ? `<i style="max-width:300px;" class="${d.imgClass} kanan img"></i>`
                : '';
        return `
            <div class="row page hero">
                <div class="col-2-3 artikel">
                    <h1>${d.title}</h1><br>
                    <em>${d.tagline || ''}</em> &mdash; ${d.description || ''}<br><br>
                    ${(d.badges || []).map(b => `<span class="badge">${escHtml(b)}</span>`).join(' ')}
                    <br><br>
                    ${d.cta ? `<a href="?${d.cta.link}" onclick="return web.navigate('${d.cta.link}')" class="btn-cta">${escHtml(d.cta.text)}</a>` : ''}
                </div>
                <div class="col-1-3 artikel">${media}</div>
            </div>`;
    },

    features: (d) => `
        <div class="row gading">
            ${(d.items || []).map(item => `
                <div class="col-1-3 artikel">
                    <i class="${item.icon} simg"></i>
                    <span class="judul">${escHtml(item.title)}</span><br>
                    <p>${escHtml(item.content)}</p>
                    ${item.linkTarget ? `<a href="javascript:void(0)" onclick="web.navigate('${item.linkTarget}')">${escHtml(item.linkText)}</a>` : ''}
                </div>`).join('')}
        </div>`,

    article: (d) => `
        <div class="row page4">
            <div class="col-1-3 artikel">
                ${d.leftCol.subtitle ? `<h2>${escHtml(d.leftCol.subtitle)}</h2><hr>` : ''}
                ${components.lineRenderer(d.leftCol.lines || [], d.leftCol)}
            </div>
            <div class="col-2-3 artikel">
                ${d.rightCol.subtitle ? `<h2>${escHtml(d.rightCol.subtitle)}</h2><hr>` : ''}
                ${components.lineRenderer(d.rightCol.lines || [], d.rightCol)}
            </div>
        </div>`,

    /** Varian 'article' satu kolom lebar penuh — dipakai oleh semua halaman CRUD POS
     *  (daftar produk/kontak/lokasi/dst butuh lebar penuh untuk tabel). */
    articleFull: (d) => `
        <div class="row page4">
            <div class="col-1-1 artikel">
                ${d.subtitle ? `<h2>${escHtml(d.subtitle)}</h2><hr>` : ''}
                ${components.lineRenderer(d.lines || [], d)}
            </div>
        </div>`,

    /** Kartu statistik (KPI) — dipakai oleh dashboard. */
    statGrid: (d) => `
        <div class="row page4 artikel">
            <div class="stat-grid">
                ${(d.stats || []).map(s => `
                    <div class="stat-card">
                        <div class="stat-value">${s.value}</div>
                        <div class="stat-label">${escHtml(s.label)}</div>
                    </div>`).join('')}
            </div>
        </div>`,

    /** Bar chart SVG generik — dipakai oleh dashboard (mis. produk terlaris).
     *  it.label bisa berasal dari nama produk (input pengguna) -> di-escape. */
    barChart: (d) => {
        const items  = d.items || [];
        const max    = Math.max(1, ...items.map(i => i.value));
        const barH = 28, gap = 10, leftW = 170, chartW = 380, topPad = 10;
        const height = items.length * (barH + gap) + topPad || (barH + topPad);

        const bars = items.map((it, i) => {
            const y = topPad + i * (barH + gap);
            const w = max ? (it.value / max) * chartW : 0;
            return `
                <text x="0" y="${y + barH / 2}" class="chart-label" text-anchor="start">${escHtml(it.label)}</text>
                <rect x="${leftW}" y="${y}" width="${w}" height="${barH}" class="chart-bar" rx="4"></rect>
                <text x="${leftW + w + 8}" y="${y + barH / 2}" class="chart-value">${escHtml(String(it.value))}</text>`;
        }).join('');

        return `
            <div class="row page4 artikel">
                <h3>${escHtml(d.title || '')}</h3>
                <div class="chart-wrap">
                    ${items.length
                        ? `<svg class="chart-svg" viewBox="0 0 ${leftW + chartW + 60} ${height}">${bars}</svg>`
                        : '<p>Belum ada data untuk ditampilkan.</p>'}
                </div>
            </div>`;
    },

    /** Tabel generik. Nilai tiap sel di-ESCAPE SECARA DEFAULT — kolom yang
     *  memang sengaja berisi HTML mentah (badge status, tombol Aksi) HARUS
     *  didaftarkan eksplisit lewat opts.rawKeys (array nama kolom persis
     *  seperti key di row, mis. ['Status','Aksi']). Tanpa ini, nilai apa
     *  pun yang berasal dari input pengguna (nama produk/kontak/lokasi/
     *  akun, keterangan, dst.) akan dirender mentah — itu stored XSS. */
    renderTable: (dataTable, opts = {}) => {
        if (!dataTable?.length) return '';
        const allKeys  = Object.keys(dataTable[0]);
        const hidden   = new Set(opts.hiddenKeys || []);
        const keys     = opts.visibleKeys ? opts.visibleKeys.filter(k => !hidden.has(k)) : allKeys.filter(k => !hidden.has(k));
        const labels   = opts.labels || {};
        const rawKeys  = new Set(opts.rawKeys || []);

        const head = keys.map(k => `<th>${escHtml(labels[k] || k.toUpperCase())}</th>`).join('');
        const body = dataTable.map(row => `<tr>${keys.map(k => {
            const val = row[k] ?? '';
            return `<td>${rawKeys.has(k) ? val : escHtml(val)}</td>`;
        }).join('')}</tr>`).join('')
            || `<tr><td colspan="${keys.length}" style="text-align:center;color:var(--aColor)">Tidak ada data.</td></tr>`;

        return `<div class="table-container"><table>
            <thead><tr>${head}</tr></thead>
            <tbody>${body}</tbody>
        </table></div>`;
    },
};

// ============================================================
// UI — Render Engine
// ============================================================
const ui = {
    render: async (id, dataArray) => {
        const el = web.gebi(id);
        if (!el || !Array.isArray(dataArray)) return;
        // [PERF] Fade halus saat konten diganti — konten lama meredup
        // sedikit sebelum ditukar, tidak menahan render (durasi singkat,
        // murni kosmetik). Lihat #content.content-fade-out di style.css.
        el.classList.add('content-fade-out');
        const rendered = await Promise.all(
            dataArray.map(d => Promise.resolve(components[d.section]?.(d) || ''))
        );
        el.innerHTML = rendered.join('');
        requestAnimationFrame(() => el.classList.remove('content-fade-out'));
    },
};

// [PERF] Render pertama dipicu langsung setelah script halaman siap
// (lihat pemanggilan loadPageScripts di index.html), BUKAN menunggu
// event 'load' penuh (yang baru selesai setelah semua gambar/aset
// lain ikut termuat — jeda yang tidak perlu untuk SPA berbasis fetch).
window.addEventListener('popstate', () => web.navigate());

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') web.closeDrawer?.();
});

document.addEventListener('click', (e) => {
    const burger = web.gebi('burgerBtn');
    const nav    = web.gebi('navLinks');
    if (burger?.contains(e.target)) {
        nav.classList.toggle('active');
        e.stopPropagation();
    } else if (nav?.classList.contains('active') && !nav.contains(e.target)) {
        nav.classList.remove('active');
    }

    if (!e.target.closest('.nav-parent')) {
        document.querySelectorAll('.nav-parent.open').forEach(el => el.classList.remove('open'));
    }
});
