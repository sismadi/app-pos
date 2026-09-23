// ============================================================
// pages/toko-online.js — Pengaturan etalase toko online milik SENDIRI
// (khusus role 'owner'). Beda dengan pages/toko.js (etalase PUBLIK,
// tanpa login): halaman ini yang login, mengelola slug link, deskripsi,
// dan tombol tampil/sembunyi dari daftar "?toko" lewat db.myTenant()/
// db.updateMyTenant() (lihat db.js & worker.js handleTenantsTable).
// ============================================================
web.routes['toko-online'] = 'resolveTokoOnline';

const tokoOnlinePage = {
    linkUntuk(tenant) {
        return `${window.location.origin}${window.location.pathname}?toko/${encodeURIComponent(tenant.slug || tenant.id)}`;
    },

    salinLink(link) {
        navigator.clipboard?.writeText(link)
            .then(() => alert('Link toko disalin ke clipboard.'))
            .catch(() => alert('Gagal menyalin otomatis, salin manual: ' + link));
    },

    async simpan(form) {
        const btn = form.querySelector('button[type="submit"]');
        const label = btn?.textContent;
        if (btn) { btn.disabled = true; btn.textContent = 'Menyimpan...'; }
        try {
            const patch = {
                slug: form.querySelector('[name="slug"]').value.trim().toLowerCase(),
                deskripsi: form.querySelector('[name="deskripsi"]').value.trim(),
                tampilOnline: form.querySelector('[name="tampilOnline"]').checked,
            };
            await db.updateMyTenant(patch);
            await web.navigate('toko-online');
        } catch (err) {
            if (btn) { btn.disabled = false; btn.textContent = label; }
            alert('Gagal menyimpan pengaturan: ' + err.message);
        }
    },
};

async function resolveTokoOnline() {
    const guard = requireLogin(['owner']);
    if (guard) return guard;

    let tenant;
    try {
        tenant = await db.myTenant();
    } catch (err) {
        return [{ section: 'titleHero', title: 'Toko Online', description: 'Gagal memuat data toko: ' + escHtml(err.message) }];
    }
    if (!tenant) return [{ section: 'titleHero', title: 'Toko Online', description: 'Data toko tidak ditemukan.' }];

    const link = tokoOnlinePage.linkUntuk(tenant);

    return [
        {
            section: 'titleHero',
            title: 'Toko Online',
            description: 'Kelola etalase belanja publik toko Anda — pembeli bisa melihat katalog produk & langsung memesan tanpa perlu akun.',
        },
        {
            section: 'articleFull',
            subtitle: 'Link Toko Anda',
            lines: [
                `<div class="info-card">
                    <p>Bagikan link ini ke pelanggan lewat WhatsApp, Instagram, atau media lain:</p>
                    <p><a href="${escHtml(link)}" target="_blank" rel="noopener" style="word-break:break-all">${escHtml(link)}</a></p>
                    <button type="button" class="slcBtn" onclick='tokoOnlinePage.salinLink(${JSON.stringify(link)})'>Salin Link</button>
                    <button type="button" class="slcBtn" style="background:#555" onclick='web.navigate(${JSON.stringify('toko/' + (tenant.slug || tenant.id))})'>Lihat Etalase</button>
                </div>`,
                !tenant.tampilOnline
                    ? `<div class="info-card"><strong>Tersembunyi dari daftar "Belanja"</strong><p>Toko Anda saat ini TIDAK muncul di daftar semua toko (menu Belanja), tapi link di atas tetap bisa dibuka siapa pun yang punya link-nya. Aktifkan opsi di bawah untuk tampil di daftar publik.</p></div>`
                    : '',
            ],
        },
        {
            section: 'articleFull',
            subtitle: 'Pengaturan Etalase',
            lines: [`
                <form class="dynamic-form" onsubmit="event.preventDefault(); tokoOnlinePage.simpan(this);">
                    <div class="a-row">
                        <label class="a-label">Slug / Kode Link Toko <span style="color:var(--aColor,#DF8C43)">*</span></label>
                        <input type="text" name="slug" value="${escHtml(tenant.slug || '')}" maxlength="50"
                               pattern="[a-z0-9][a-z0-9_-]{1,49}" title="Huruf kecil, angka, strip, atau underscore"
                               placeholder="mis. jaya" required>
                    </div>
                    <div class="a-row">
                        <label class="a-label">Deskripsi Toko (opsional)</label>
                        <textarea name="deskripsi" rows="3" maxlength="300" placeholder="Ceritakan toko Anda ke calon pembeli...">${escHtml(tenant.deskripsi || '')}</textarea>
                    </div>
                    <div class="a-row">
                        <label class="a-label" style="display:flex;align-items:center;gap:8px;font-weight:normal">
                            <input type="checkbox" name="tampilOnline" ${tenant.tampilOnline ? 'checked' : ''} style="width:auto">
                            Tampilkan toko ini di daftar "Belanja" publik
                        </label>
                    </div>
                    <button type="submit" class="slcBtn">Simpan Pengaturan</button>
                </form>`],
        },
    ];
}
