// ============================================================
// pages/toko.js — Etalase belanja PUBLIK: daftar toko + produknya,
// supaya pembeli umum (TANPA login) bisa langsung memesan di
// pos.piawai.id/?toko.
//
// Beda dengan kasir/transaksi/distribusi (pages/shared.js):
//   - Data diambil lewat db.storefrontTokoList()/storefrontTokoDetail()
//     -> endpoint /public di worker.js, TIDAK butuh sesi/tenant aktif.
//   - Checkout TIDAK memakai createInstantDocumentPage (itu untuk staf
//     yang SUDAH login & tenant-nya sendiri). Yang dipakai ulang cuma
//     mesin katalog+keranjang (createCatalogCart dari shared.js) —
//     pembeli tidak login, tidak pilih Lokasi/Kontak, dan checkout-nya
//     memanggil endpoint publik (db.storefrontPesan), BUKAN db.insert.
//   - Pesanan masuk sebagai 1 baris `transaksi` berstatus 'draft'
//     ("Pesanan Online") — stok BELUM dipotong & jurnal BELUM diposting.
//     Pemilik/kasir toko mengonfirmasi lewat tombol "Konfirmasi Pesanan"
//     di halaman detail Transaksi (lihat pages/transaksi.js) — baru di
//     situ stok terpotong & jurnal terposting lewat /api yang memang
//     sudah tervalidasi tenant, supaya pembeli anonim tidak pernah bisa
//     langsung mengubah stok/keuangan toko orang lain.
// ============================================================
web.routes.toko = 'resolveToko';

const tokoPage = createCatalogCart('tokoPage', {
    getPrice: (p) => p.hargaJual || 0,
    getStock: (p) => (p.stok !== undefined ? p.stok : null),
    cartTitle: 'Keranjang Belanja',
    emptyCatalogMsg: 'Toko ini belum punya produk aktif.',
    emptyCartMsg: 'Keranjang masih kosong. Ketuk produk untuk menambah.',
    confirmLabel: (ctrl) => `Kirim Pesanan (${formatRupiah(ctrl.total())})`,
    extraFieldsHtml: () => `
        <div class="a-row"><label class="a-label">Nama Anda <span style="color:var(--aColor,#DF8C43)">*</span></label>
            <input type="text" name="pembeliNama" required maxlength="120" placeholder="Nama lengkap"></div>
        <div class="a-row"><label class="a-label">No. WhatsApp/Telepon <span style="color:var(--aColor,#DF8C43)">*</span></label>
            <input type="text" name="pembeliTelepon" required maxlength="40" placeholder="08xxxxxxxxxx"></div>
        <div class="a-row"><label class="a-label">Alamat Pengiriman / Catatan</label>
            <textarea name="pembeliAlamat" rows="2" maxlength="240" placeholder="Opsional"></textarea></div>`,
    onCartChange: (ctrl) => ctrl.updateFab(),
    onConfirm: async (cart, form) => tokoPage.kirimPesanan(cart, form),
});

Object.assign(tokoPage, {
    tenant: null,
    tenantId: '',

    /** Muat profil toko + katalog produknya lewat endpoint publik. */
    async muatToko(tenantId) {
        const { tenant, produk } = await db.storefrontTokoDetail(tenantId);
        this.tenant = tenant;
        this.tenantId = tenantId;
        this.kataKunci = '';
        this.kategoriAktif = '';
        this.setProdukList(produk || []);
    },

    /** FAB keranjang di kanan-bawah (markup sama seperti pageBlocks di shared.js). */
    updateFab() {
        const fab = web.gebi('tokoPageFab');
        if (!fab) return;
        fab.querySelector('.catcart-fab-count').textContent = this.jumlahItem();
        fab.querySelector('.catcart-fab-total').textContent = formatRupiah(this.total());
        fab.classList.toggle('hide', this.jumlahItem() === 0);
    },

    /** Kirim pesanan ke endpoint publik (bukan db.insert — lihat catatan di atas). */
    async kirimPesanan(cart, form) {
        const pembeli = {
            nama: form.querySelector('[name="pembeliNama"]')?.value.trim() || '',
            telepon: form.querySelector('[name="pembeliTelepon"]')?.value.trim() || '',
            alamat: form.querySelector('[name="pembeliAlamat"]')?.value.trim() || '',
        };
        if (!pembeli.nama || !pembeli.telepon) throw new Error('Nama & telepon wajib diisi.');

        const items = cart.map(c => ({ produkId: c.produkId, qty: c.qty }));
        const hasil = await db.storefrontPesan({ tenantId: this.tenantId, pembeli, items });

        web.closeDrawer();
        alert(`Pesanan terkirim! Toko akan menghubungi ${pembeli.nama} di ${pembeli.telepon} untuk konfirmasi & pengiriman. (Ref: ${hasil.id})`);
    },

    pageBlocks() {
        const catalogHtml = `
            <div class="catcart-toolbar">
                <input type="search" placeholder="Cari produk..." oninput="tokoPage.cariProduk(this.value)" class="catcart-search">
                <div class="catcart-chips" id="tokoPageChips">${this.chipsHtml()}</div>
            </div>
            <div id="tokoPageGrid">${this.gridHtml()}</div>
            <div class="catcart-fab hide" id="tokoPageFab" onclick="tokoPage.openCart()">
                <span>&#128722; <span class="catcart-fab-count">0</span> item</span>
                <span class="catcart-fab-total">Rp0</span>
            </div>`;
        return [
            {
                section: 'titleHero',
                title: escHtml(this.tenant.nama),
                description: `${escHtml(this.tenant.alamat || '')}${this.tenant.telepon ? ' &middot; ' + escHtml(this.tenant.telepon) : ''}`,
            },
            {
                section: 'articleFull',
                lines: [
                    `<button class="slcBtn" style="background:#555" onclick="web.navigate('toko')">&larr; Semua Toko</button>`,
                    catalogHtml,
                ],
            },
        ];
    },
});

async function resolveToko(sub) {
    // --- Halaman katalog satu toko (?toko/<tenantId>) ---
    if (sub) {
        try {
            await tokoPage.muatToko(sub);
        } catch (err) {
            return [{ section: 'titleHero', title: 'Toko Tidak Ditemukan', description: escHtml(err.message) }];
        }
        if (!tokoPage.tenant) return [{ section: 'titleHero', title: 'Toko Tidak Ditemukan' }];
        return tokoPage.pageBlocks();
    }

    // --- Daftar semua toko (?toko) ---
    let daftar = [];
    try {
        daftar = await db.storefrontTokoList();
    } catch (err) {
        return [{ section: 'titleHero', title: 'Belanja', description: 'Gagal memuat daftar toko: ' + escHtml(err.message) }];
    }

    const kartu = daftar.map(t => `
        <button type="button" class="catcart-product-card" onclick='web.navigate(${JSON.stringify('toko/' + t.id)})'>
            <span class="catcart-product-nama">${escHtml(t.nama)}</span>
            <span class="catcart-product-kategori">${escHtml(t.alamat || '') || '&nbsp;'}</span>
            ${t.telepon ? `<span class="catcart-product-harga">${escHtml(t.telepon)}</span>` : ''}
        </button>`).join('');

    return [
        { section: 'titleHero', title: 'Belanja', description: 'Pilih toko untuk melihat produk & langsung memesan — tanpa perlu akun.' },
        {
            section: 'articleFull',
            lines: daftar.length
                ? [`<div class="catcart-grid">${kartu}</div>`]
                : ['Belum ada toko yang membuka etalase online saat ini.'],
        },
    ];
}
