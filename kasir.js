// ============================================================
// pages/kasir.js — Layar Kasir: katalog produk (grid, bisa dicari
// & difilter kategori) + keranjang belanja yang dibuka di drawer
// geser-kanan yang sama dipakai form tambah/edit (lihat
// web.openDrawer di engine.js, sekarang mendukung cfg.bodyHtml
// untuk konten non-form seperti keranjang ini).
//
// Beda dengan alur "Transaksi" (draft -> tambah baris satu-satu
// -> finalisasi manual): di sini SATU tombol "Bayar" langsung
// membuat transaksi jual, baris produknya, menyesuaikan stok, dan
// (kalau QRIS) membuat baris pembayaran — meniru alur kasir toko
// sungguhan. Setelah bayar, diarahkan ke halaman detail transaksi
// yang sudah ada (struk + kode QRIS demo).
// ============================================================
web.routes.kasir = 'resolveKasir';

const kasirPage = {
    cart: [],           // [{ produkId, nama, harga, qty }]
    produkList: [],
    lokasiList: [],
    kontakList: [],
    kategoriAktif: '',
    kataKunci: '',

    async load() {
        const [produk, lokasi, kontak] = await Promise.all([
            db.query('produk', p => p.aktif),
            db.query('lokasi', () => true),
            db.query('kontak', k => k.tipe === 'customer'),
        ]);
        this.produkList = produk;
        this.lokasiList = lokasi;
        this.kontakList = kontak;
    },

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

    renderGrid() {
        const chips = web.gebi('kasirKategoriChips');
        const grid  = web.gebi('kasirGrid');
        if (chips) chips.innerHTML = this.chipsHtml();
        if (grid) grid.innerHTML = this.gridHtml();
    },

    chipsHtml() {
        const semua = `<button type="button" class="kasir-chip ${!this.kategoriAktif ? 'active' : ''}" onclick="kasirPage.pilihKategori('')">Semua</button>`;
        return semua + this.kategoriList().map(k =>
            `<button type="button" class="kasir-chip ${this.kategoriAktif === k ? 'active' : ''}" onclick="kasirPage.pilihKategori('${k}')">${k}</button>`
        ).join('');
    },

    gridHtml() {
        const list = this.produkTersaring();
        if (!list.length) return `<div class="info-card">Tidak ada produk yang cocok.</div>`;
        return `<div class="kasir-catalog-grid">${list.map(p => {
            const line = this.cart.find(c => c.produkId === p.id);
            return `
            <button type="button" class="kasir-product-card" onclick="kasirPage.tambah('${p.id}')">
                ${line ? `<span class="kasir-qty-badge">${line.qty}</span>` : ''}
                <span class="kasir-product-nama">${p.nama}</span>
                <span class="kasir-product-kategori">${p.kategori || '&nbsp;'}</span>
                <span class="kasir-product-harga">${formatRupiah(p.hargaJual)}</span>
            </button>`;
        }).join('')}</div>`;
    },

    tambah(produkId) {
        const p = this.produkList.find(x => x.id === produkId);
        if (!p) return;
        const line = this.cart.find(c => c.produkId === produkId);
        if (line) line.qty += 1;
        else this.cart.push({ produkId, nama: p.nama, harga: p.hargaJual, qty: 1 });
        this.renderGrid();
        this.updateFab();
    },

    ubahQty(produkId, delta) {
        const line = this.cart.find(c => c.produkId === produkId);
        if (!line) return;
        line.qty += delta;
        if (line.qty <= 0) this.cart = this.cart.filter(c => c.produkId !== produkId);
        this.renderGrid();
        this.updateFab();
        this.openCart(); // drawer sedang terbuka saat tombol qty dipakai -> refresh isinya
    },

    hapusDariKeranjang(produkId) {
        this.cart = this.cart.filter(c => c.produkId !== produkId);
        this.renderGrid();
        this.updateFab();
        this.openCart();
    },

    total() { return this.cart.reduce((s, c) => s + c.qty * c.harga, 0); },
    jumlahItem() { return this.cart.reduce((s, c) => s + c.qty, 0); },

    updateFab() {
        const fab = web.gebi('kasirFab');
        if (!fab) return;
        fab.querySelector('.kasir-fab-count').textContent = this.jumlahItem();
        fab.querySelector('.kasir-fab-total').textContent = formatRupiah(this.total());
        fab.classList.toggle('hide', this.jumlahItem() === 0);
    },

    openCart() {
        if (!this.lokasiList.length) return alert('Buat lokasi terlebih dahulu di menu Lokasi.');
        web.openDrawer({ title: `Keranjang (${this.jumlahItem()})`, bodyHtml: this.cartHtml() });
    },

    cartHtml() {
        if (!this.cart.length) {
            return `<div class="info-card">Keranjang masih kosong. Ketuk produk di katalog untuk menambah.</div>`;
        }
        const rows = this.cart.map(c => `
            <div class="kasir-cart-row">
                <div class="kasir-cart-row-info">
                    <strong>${c.nama}</strong>
                    <span>${formatRupiah(c.harga)} &times; ${c.qty} = ${formatRupiah(c.harga * c.qty)}</span>
                </div>
                <div class="kasir-cart-row-qty">
                    <button type="button" onclick="kasirPage.ubahQty('${c.produkId}', -1)">&minus;</button>
                    <span>${c.qty}</span>
                    <button type="button" onclick="kasirPage.ubahQty('${c.produkId}', 1)">+</button>
                    <button type="button" class="kasir-cart-row-hapus" onclick="kasirPage.hapusDariKeranjang('${c.produkId}')">&times;</button>
                </div>
            </div>`).join('');

        const lokasiOpt = this.lokasiList.map(l => `<option value="${l.id}">${l.nama}</option>`).join('');
        const kontakOpt = this.kontakList.map(k => `<option value="${k.id}">${k.nama}</option>`).join('');

        return `
            <div class="kasir-cart-list">${rows}</div>
            <div class="kasir-cart-total-row"><span>Total</span><strong>${formatRupiah(this.total())}</strong></div>
            <hr>
            <form class="dynamic-form" onsubmit="event.preventDefault(); kasirPage.checkout(this);">
                <div class="a-row"><label class="a-label">Lokasi</label>
                    <select name="lokasiId" required>${lokasiOpt}</select></div>
                <div class="a-row"><label class="a-label">Customer</label>
                    <select name="kontakId"><option value="">&mdash; umum / tanpa nama &mdash;</option>${kontakOpt}</select></div>
                <div class="a-row"><label class="a-label">Bayar dengan</label>
                    <select name="metodePembayaran">
                        <option value="tunai">Tunai</option>
                        <option value="qris">QRIS</option>
                    </select></div>
                <button type="submit" class="slcBtn kasir-bayar-btn">Bayar ${formatRupiah(this.total())}</button>
            </form>`;
    },

    /** Checkout langsung: header + baris + penyesuaian stok + (opsional) pembayaran QRIS,
     *  tanpa lewat status draft — meniru transaksi kasir sungguhan yang selesai seketika. */
    async checkout(form) {
        if (!this.cart.length) return alert('Keranjang masih kosong.');
        const val = (n) => form.querySelector(`[name="${n}"]`)?.value;
        const lokasiId = val('lokasiId');
        if (!lokasiId) return alert('Pilih lokasi.');
        const kontakId = val('kontakId') || null;
        const metodePembayaran = val('metodePembayaran') || 'tunai';
        const total = this.total();

        const btn = form.querySelector('button[type="submit"]');
        if (btn) { btn.disabled = true; btn.textContent = 'Memproses...'; }

        try {
            const header = await db.insert('transaksi', {
                tipe: 'jual',
                nomor: 'TR-' + Date.now().toString(36).toUpperCase(),
                tanggal: new Date().toISOString().slice(0, 10),
                lokasiId, kontakId, status: 'draft',
                metodePembayaran, totalBayar: total, catatan: '',
                createdAt: new Date().toISOString(),
            });

            for (const c of this.cart) {
                await db.insert('transaksi_produk', {
                    transaksiId: header.id, produkId: c.produkId,
                    qty: c.qty, hargaSatuan: c.harga, subtotal: c.qty * c.harga,
                });
            }

            for (const c of this.cart) {
                const existing = await db.find('lokasi_produk', s => s.lokasiId === lokasiId && s.produkId === c.produkId);
                const stokLama = existing?.stok || 0;
                const stokBaru = stokLama - c.qty;
                if (existing) await db.update('lokasi_produk', existing.id, { stok: stokBaru });
                else await db.insert('lokasi_produk', { lokasiId, produkId: c.produkId, stok: stokBaru, stokMinimum: 0 });
            }

            await db.update('transaksi', header.id, { status: 'selesai' });
            if (metodePembayaran === 'qris' && typeof qrisPage !== 'undefined') {
                await qrisPage.buatPembayaran(header.id, total);
            }

            this.cart = [];
            this.updateFab();
            web.closeDrawer();
            web.navigate(`transaksi/detail-${header.id}`);
        } catch (err) {
            if (btn) { btn.disabled = false; btn.textContent = `Bayar ${formatRupiah(total)}`; }
            alert('Gagal memproses pembayaran: ' + err.message);
        }
    },
};

async function resolveKasir() {
    const guard = requireLogin(['owner', 'kasir']);
    if (guard) return guard;

    await kasirPage.load();
    kasirPage.cart = [];
    kasirPage.kataKunci = '';
    kasirPage.kategoriAktif = '';

    if (!kasirPage.lokasiList.length) {
        return [
            { section: 'titleHero', title: 'Kasir', description: 'Layar kasir untuk transaksi jual cepat.' },
            { section: 'articleFull', subtitle: 'Belum Bisa Berjualan', lines: ['Buat minimal 1 lokasi di menu Lokasi sebelum memakai layar Kasir.'] },
        ];
    }
    if (!kasirPage.produkList.length) {
        return [
            { section: 'titleHero', title: 'Kasir', description: 'Layar kasir untuk transaksi jual cepat.' },
            { section: 'articleFull', subtitle: 'Belum Ada Produk', lines: ['Tambahkan produk aktif di menu Produk sebelum memakai layar Kasir.'] },
        ];
    }

    const catalogHtml = `
        <div class="kasir-toolbar">
            <input type="search" placeholder="Cari produk..." oninput="kasirPage.cariProduk(this.value)" class="kasir-search">
            <div class="kasir-chips" id="kasirKategoriChips">${kasirPage.chipsHtml()}</div>
        </div>
        <div id="kasirGrid">${kasirPage.gridHtml()}</div>
        <div class="kasir-fab hide" id="kasirFab" onclick="kasirPage.openCart()">
            <span>&#128722; <span class="kasir-fab-count">0</span> item</span>
            <span class="kasir-fab-total">Rp0</span>
        </div>`;

    return [
        { section: 'titleHero', title: 'Kasir', description: 'Ketuk produk untuk menambah ke keranjang, lalu ketuk tombol keranjang di kanan-bawah untuk bayar.' },
        { section: 'articleFull', lines: [catalogHtml] },
    ];
}
