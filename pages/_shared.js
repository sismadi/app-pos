// ============================================================
// pages/_shared.js — Komponen BERSAMA lintas halaman transaksional
// (kasir, distribusi, transaksi). Ketiganya sama-sama butuh dua hal:
//   1) memilih Lokasi (+ Kontak)  -> lokasiKontakFields()
//   2) memilih produk + jumlah dari katalog, lalu keranjang -> createCatalogCart()
// Sebelumnya logika katalog+keranjang cuma ada di kasir.js (duplikasi
// kalau mau dipakai di tempat lain); sekarang dipindah ke sini supaya
// distribusi.js & transaksi.js bisa PAKAI ULANG persis komponen yang
// sama saat menambah baris produk, alih-alih form dropdown satu produk
// per submit. Konsisten, DRY, dan mudah dipakai halaman baru nanti
// (scalable) — dimuat PALING AWAL (lihat dataset.js) supaya siap dipakai
// semua pages/*.js lain.
//
// Pola "override-only": createCatalogCart() mengembalikan OBJEK DASAR
// dengan method generik (grid, cari, filter kategori, baris keranjang).
// Halaman pemanggil menimpa/menambah method di atasnya sesuai kebutuhan
// masing-masing (checkout instan di kasir, simpan-banyak-baris di
// distribusi/transaksi) — bagian generiknya tidak pernah diulang.
// ============================================================

/** Definisi field <select> Lokasi & Kontak, dipakai ulang oleh form header
 *  kasir/distribusi/transaksi supaya label & opsi selalu konsisten. */
function lokasiKontakFields(lokasiList, kontakList, opts = {}) {
    return [
        { type: 'select', name: 'lokasiId', label: opts.lokasiLabel || 'Lokasi', required: opts.lokasiRequired !== false,
          options: lokasiList.map(l => ({ value: l.id, label: `${l.nama} (${l.tipe === 'toko' ? 'Toko' : 'Gudang'})` })) },
        { type: 'select', name: 'kontakId', label: opts.kontakLabel || 'Kontak (opsional)',
          options: kontakList.map(k => ({ value: k.id, label: k.nama })) },
    ];
}

/**
 * createCatalogCart(name, cfg) — "mesin" katalog produk (cari + filter
 * kategori + grid) & keranjang (qty +/-, hapus, harga bisa diedit
 * opsional, total, form konfirmasi). Hasilnya didaftarkan ke `window[name]`
 * supaya markup onclick="..." yang dirender lewat innerHTML bisa
 * memanggilnya langsung (pola yang sama dengan objek halaman lain di
 * aplikasi ini, mis. kasirPage/distribusiPage).
 *
 * cfg:
 *   getPrice(p)            wajib — harga satuan yang ditampilkan/dipakai
 *   getStock(p)             opsional — angka stok untuk badge di kartu produk
 *   allowPriceEdit           opsional — tampilkan input harga yang bisa diubah per baris
 *   cartTitle                opsional — judul drawer keranjang
 *   emptyCatalogMsg / emptyCartMsg
 *   confirmLabel(ctrl)      -> teks tombol konfirmasi
 *   extraFieldsHtml()        opsional -> HTML field tambahan di atas tombol konfirmasi
 *   onConfirm(cart, form, ctrl) wajib — eksekusi hasil keranjang (checkout / simpan baris)
 *   onCartChange(ctrl)       opsional -> dipanggil tiap keranjang berubah (mis. update FAB)
 */
function createCatalogCart(name, cfg) {
    const ctrl = {
        cart: [],
        produkList: [],
        kategoriAktif: '',
        kataKunci: '',
        _cfg: cfg,
        _name: name,

        setProdukList(list) { this.produkList = list; this.cart = []; },

        kategoriList() {
            return [...new Set(this.produkList.map(p => p.kategori).filter(Boolean))];
        },

        produkTersaring() {
            const kw = this.kataKunci.trim().toLowerCase();
            return this.produkList.filter(p =>
                (!this.kategoriAktif || p.kategori === this.kategoriAktif) &&
                (!kw || p.nama.toLowerCase().includes(kw) || (p.kode || '').toLowerCase().includes(kw)));
        },

        cariProduk(kw) { this.kataKunci = kw; this.renderGrid(); },
        pilihKategori(k) { this.kategoriAktif = k; this.renderGrid(); },

        /** Refresh grid+chips (kalau ada di halaman) DAN wadah keranjang
         *  (kalau ada, baik itu keranjang di drawer terpisah maupun yang
         *  digabung satu layar dengan katalog — lihat pickerBodyHtml). */
        renderGrid() {
            const chips = web.gebi(`${this._name}Chips`);
            const grid  = web.gebi(`${this._name}Grid`);
            if (chips) chips.innerHTML = this.chipsHtml();
            if (grid) grid.innerHTML = this.gridHtml();
            const cartWrap = web.gebi(`${this._name}CartWrap`);
            if (cartWrap) cartWrap.innerHTML = this.cartHtml();
        },

        chipsHtml() {
            const semua = `<button type="button" class="catcart-chip ${!this.kategoriAktif ? 'active' : ''}" onclick="${this._name}.pilihKategori('')">Semua</button>`;
            return semua + this.kategoriList().map(k =>
                `<button type="button" class="catcart-chip ${this.kategoriAktif === k ? 'active' : ''}" onclick="${this._name}.pilihKategori('${k}')">${k}</button>`
            ).join('');
        },

        gridHtml() {
            const list = this.produkTersaring();
            if (!list.length) return `<div class="info-card">${this._cfg.emptyCatalogMsg || 'Tidak ada produk yang cocok.'}</div>`;
            return `<div class="catcart-grid">${list.map(p => {
                const line = this.cart.find(c => c.produkId === p.id);
                const stok = this._cfg.getStock ? this._cfg.getStock(p) : null;
                return `
                <button type="button" class="catcart-product-card" onclick="${this._name}.tambah('${p.id}')">
                    ${line ? `<span class="catcart-qty-badge">${line.qty}</span>` : ''}
                    <span class="catcart-product-nama">${p.nama}</span>
                    <span class="catcart-product-kategori">${p.kategori || '&nbsp;'}${stok !== null ? ` &middot; stok ${stok}` : ''}</span>
                    <span class="catcart-product-harga">${formatRupiah(this._cfg.getPrice(p))}</span>
                </button>`;
            }).join('')}</div>`;
        },

        tambah(produkId) {
            const p = this.produkList.find(x => x.id === produkId);
            if (!p) return;
            const line = this.cart.find(c => c.produkId === produkId);
            if (line) line.qty += 1;
            else this.cart.push({ produkId, nama: p.nama, harga: this._cfg.getPrice(p), qty: 1 });
            this.renderGrid();
            this._cfg.onCartChange?.(this);
        },

        ubahQty(produkId, delta) {
            const line = this.cart.find(c => c.produkId === produkId);
            if (!line) return;
            line.qty += delta;
            if (line.qty <= 0) this.cart = this.cart.filter(c => c.produkId !== produkId);
            this.renderGrid();
            this._cfg.onCartChange?.(this);
        },

        ubahHarga(produkId, harga) {
            const line = this.cart.find(c => c.produkId === produkId);
            if (line) line.harga = parseFloat(harga) || 0;
        },

        hapusDariKeranjang(produkId) {
            this.cart = this.cart.filter(c => c.produkId !== produkId);
            this.renderGrid();
            this._cfg.onCartChange?.(this);
        },

        total() { return this.cart.reduce((s, c) => s + c.qty * c.harga, 0); },
        jumlahItem() { return this.cart.reduce((s, c) => s + c.qty, 0); },

        cartHtml() {
            if (!this.cart.length) {
                return `<div class="info-card">${this._cfg.emptyCartMsg || 'Keranjang masih kosong. Ketuk produk di katalog untuk menambah.'}</div>`;
            }
            const rows = this.cart.map(c => `
                <div class="catcart-cart-row">
                    <div class="catcart-cart-row-info">
                        <strong>${c.nama}</strong>
                        <span>
                            ${this._cfg.allowPriceEdit
                                ? `<input type="number" min="0" step="any" value="${c.harga}" class="catcart-harga-input" onchange="${this._name}.ubahHarga('${c.produkId}', this.value)">`
                                : formatRupiah(c.harga)}
                            &times; ${c.qty} = ${formatRupiah(c.harga * c.qty)}
                        </span>
                    </div>
                    <div class="catcart-cart-row-qty">
                        <button type="button" onclick="${this._name}.ubahQty('${c.produkId}', -1)">&minus;</button>
                        <span>${c.qty}</span>
                        <button type="button" onclick="${this._name}.ubahQty('${c.produkId}', 1)">+</button>
                        <button type="button" class="catcart-cart-row-hapus" onclick="${this._name}.hapusDariKeranjang('${c.produkId}')">&times;</button>
                    </div>
                </div>`).join('');

            return `
                <div class="catcart-cart-list">${rows}</div>
                <div class="catcart-cart-total-row"><span>Total</span><strong>${formatRupiah(this.total())}</strong></div>
                <hr>
                <form class="dynamic-form" onsubmit="event.preventDefault(); ${this._name}.confirm(this);">
                    ${this._cfg.extraFieldsHtml ? this._cfg.extraFieldsHtml() : ''}
                    <button type="submit" class="slcBtn catcart-confirm-btn">${typeof this._cfg.confirmLabel === 'function' ? this._cfg.confirmLabel(this) : (this._cfg.confirmLabel || `Konfirmasi (${formatRupiah(this.total())})`)}</button>
                </form>`;
        },

        /** Mode "keranjang saja" di drawer terpisah — katalognya tetap di
         *  halaman utama (dipakai kasir: grid layar penuh + drawer keranjang). */
        openCart() {
            web.openDrawer({ title: `${this._cfg.cartTitle || 'Keranjang'} (${this.jumlahItem()})`,
                bodyHtml: `<div id="${this._name}CartWrap">${this.cartHtml()}</div>` });
        },

        /** Mode "picker" gabungan: cari+kategori+grid+keranjang dalam SATU
         *  drawer (dipakai distribusi/transaksi: dibuka dari halaman detail
         *  dokumen yang tidak punya area katalog sendiri). */
        pickerBodyHtml() {
            return `
                <div class="catcart-toolbar">
                    <input type="search" placeholder="Cari produk..." oninput="${this._name}.cariProduk(this.value)" class="catcart-search">
                    <div class="catcart-chips" id="${this._name}Chips">${this.chipsHtml()}</div>
                </div>
                <div id="${this._name}Grid">${this.gridHtml()}</div>
                <hr>
                <div id="${this._name}CartWrap">${this.cartHtml()}</div>`;
        },

        openPicker(title) {
            web.openDrawer({ title: title || this._cfg.cartTitle || 'Pilih Produk', bodyHtml: this.pickerBodyHtml() });
        },

        /** Default: delegasikan ke cfg.onConfirm (checkout kasir / simpan
         *  banyak baris distribusi-transaksi). Halaman pemanggil BOLEH
         *  menimpa method ini kalau butuh alur berbeda. */
        async confirm(form) {
            if (!this.cart.length) return alert('Keranjang masih kosong.');
            const btn = form.querySelector('button[type="submit"]');
            const label = btn?.textContent;
            if (btn) { btn.disabled = true; btn.textContent = 'Memproses...'; }
            try {
                await this._cfg.onConfirm(this.cart, form, this);
                this.cart = [];
            } catch (err) {
                if (btn) { btn.disabled = false; btn.textContent = label; }
                alert('Gagal memproses: ' + err.message);
            }
        },
    };
    window[name] = ctrl;
    return ctrl;
}
