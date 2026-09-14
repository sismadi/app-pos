// ============================================================
// pages/kasir.js — Layar Kasir: pilih Lokasi + Customer di ATAS (sama
// seperti pola header distribusi/transaksi), lalu katalog produk (grid,
// bisa dicari & difilter kategori, menampilkan stok real di lokasi
// terpilih) + keranjang belanja. Katalog+keranjangnya sendiri sekarang
// komponen BERSAMA (lihat pages/shared.js -> createCatalogCart), dipakai
// ulang juga oleh distribusi.js & transaksi.js supaya perlakuannya
// konsisten di ketiga halaman.
//
// Beda dengan alur "Transaksi" (draft -> tambah baris satu-satu ->
// finalisasi manual): di sini SATU tombol "Bayar" langsung membuat
// transaksi jual, baris produknya, menyesuaikan stok, dan (kalau QRIS)
// membuat baris pembayaran — meniru alur kasir toko sungguhan. Setelah
// bayar, diarahkan ke halaman detail transaksi yang sudah ada (struk +
// kode QRIS demo).
// ============================================================
web.routes.kasir = 'resolveKasir';

const kasirPage = Object.assign(createCatalogCart('kasirPage', {
    cartTitle: 'Keranjang',
    allowPriceEdit: false,
    getPrice: (p) => p.hargaJual || 0,
    getStock: (p) => kasirPage.stokMap[p.id] ?? 0,
    emptyCatalogMsg: 'Tidak ada produk yang cocok.',
    emptyCartMsg: 'Keranjang masih kosong. Ketuk produk di katalog untuk menambah.',
    extraFieldsHtml: () => `
        <div class="a-row"><label class="a-label">Bayar dengan</label>
            <select name="metodePembayaran">
                <option value="tunai">Tunai</option>
                <option value="qris">QRIS</option>
            </select></div>`,
    confirmLabel: (ctrl) => `Bayar ${formatRupiah(ctrl.total())}`,
    onCartChange: (ctrl) => ctrl.updateFab(),
    onConfirm: async (cart, form) => kasirPage.checkout(cart, form),
}), {
    // --- State khusus kasir: lokasi & customer aktif, dipilih di atas ---
    lokasiList: [],
    kontakList: [],
    lokasiId: '',
    kontakId: '',
    stokMap: {},

    async load() {
        const [lokasi, kontak] = await Promise.all([
            db.query('lokasi', () => true),
            db.query('kontak', k => k.tipe === 'customer'),
        ]);
        this.lokasiList = lokasi;
        this.kontakList = kontak;
        if (!this.lokasiId || !lokasi.some(l => l.id === this.lokasiId)) {
            this.lokasiId = lokasi[0]?.id || '';
        }
        await this.muatKatalogLokasi();
    },

    /** Muat ulang katalog + peta stok untuk lokasi aktif — dipanggil saat
     *  masuk halaman dan tiap kali kasir GANTI lokasi. */
    async muatKatalogLokasi() {
        const [produk, stok] = await Promise.all([
            db.query('produk', p => p.aktif),
            this.lokasiId ? db.query('lokasi_produk', s => s.lokasiId === this.lokasiId) : Promise.resolve([]),
        ]);
        this.stokMap = Object.fromEntries(stok.map(s => [s.produkId, s.stok]));
        this.setProdukList(produk); // reset keranjang juga: stok/harga per lokasi bisa beda
    },

    async gantiLokasi(lokasiId) {
        this.lokasiId = lokasiId;
        await this.muatKatalogLokasi();
        this.renderGrid();
        this.updateFab();
    },

    gantiKontak(kontakId) { this.kontakId = kontakId; },

    headerBarHtml() {
        const lokasiOpt = this.lokasiList.map(l =>
            `<option value="${l.id}" ${l.id === this.lokasiId ? 'selected' : ''}>${l.nama}</option>`).join('');
        const kontakOpt = this.kontakList.map(k =>
            `<option value="${k.id}" ${k.id === this.kontakId ? 'selected' : ''}>${k.nama}</option>`).join('');
        return `
            <div class="catcart-header-bar">
                <label>Lokasi
                    <select onchange="kasirPage.gantiLokasi(this.value)">${lokasiOpt}</select>
                </label>
                <label>Customer
                    <select onchange="kasirPage.gantiKontak(this.value)">
                        <option value="">&mdash; umum / tanpa nama &mdash;</option>${kontakOpt}
                    </select>
                </label>
            </div>`;
    },

    updateFab() {
        const fab = web.gebi('kasirFab');
        if (!fab) return;
        fab.querySelector('.catcart-fab-count').textContent = this.jumlahItem();
        fab.querySelector('.catcart-fab-total').textContent = formatRupiah(this.total());
        fab.classList.toggle('hide', this.jumlahItem() === 0);
    },

    /** Checkout langsung: header + baris + penyesuaian stok + (opsional) pembayaran
     *  QRIS, tanpa lewat status draft — meniru transaksi kasir sungguhan yang
     *  selesai seketika. Lokasi & customer sudah dipilih di atas, jadi form
     *  keranjang cuma perlu menanyakan metode pembayaran. */
    async checkout(cart, form) {
        if (!this.lokasiId) return alert('Pilih lokasi terlebih dahulu.');
        const val = (n) => form.querySelector(`[name="${n}"]`)?.value;
        const metodePembayaran = val('metodePembayaran') || 'tunai';
        const total = cart.reduce((s, c) => s + c.qty * c.harga, 0);

        const header = await db.insert('transaksi', {
            tipe: 'jual',
            nomor: 'TR-' + Date.now().toString(36).toUpperCase(),
            tanggal: new Date().toISOString().slice(0, 10),
            lokasiId: this.lokasiId, kontakId: this.kontakId || null, status: 'draft',
            metodePembayaran, totalBayar: total, catatan: '',
            createdAt: new Date().toISOString(),
        });

        for (const c of cart) {
            await db.insert('transaksi_produk', {
                transaksiId: header.id, produkId: c.produkId,
                qty: c.qty, hargaSatuan: c.harga, subtotal: c.qty * c.harga,
            });
        }

        for (const c of cart) {
            const existing = await db.find('lokasi_produk', s => s.lokasiId === this.lokasiId && s.produkId === c.produkId);
            const stokLama = existing?.stok || 0;
            const stokBaru = stokLama - c.qty;
            if (existing) await db.update('lokasi_produk', existing.id, { stok: stokBaru });
            else await db.insert('lokasi_produk', { lokasiId: this.lokasiId, produkId: c.produkId, stok: stokBaru, stokMinimum: 0 });
        }

        await db.update('transaksi', header.id, { status: 'selesai' });
        if (metodePembayaran === 'qris' && typeof qrisPage !== 'undefined') {
            await qrisPage.buatPembayaran(header.id, total);
        }

        this.updateFab();
        web.closeDrawer();
        web.navigate(`transaksi/detail-${header.id}`);
    },
});

async function resolveKasir() {
    const guard = requireLogin(['owner', 'kasir']);
    if (guard) return guard;

    await kasirPage.load();
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
        <div id="kasirPageHeaderBar">${kasirPage.headerBarHtml()}</div>
        <div class="catcart-toolbar">
            <input type="search" placeholder="Cari produk..." oninput="kasirPage.cariProduk(this.value)" class="catcart-search">
            <div class="catcart-chips" id="kasirPageChips">${kasirPage.chipsHtml()}</div>
        </div>
        <div id="kasirPageGrid">${kasirPage.gridHtml()}</div>
        <div class="catcart-fab hide" id="kasirFab" onclick="kasirPage.openCart()">
            <span>&#128722; <span class="catcart-fab-count">0</span> item</span>
            <span class="catcart-fab-total">Rp0</span>
        </div>`;

    return [
        { section: 'titleHero', title: 'Kasir', description: 'Pilih lokasi & customer di atas, ketuk produk untuk menambah ke keranjang, lalu ketuk tombol keranjang di kanan-bawah untuk bayar.' },
        { section: 'articleFull', lines: [catalogHtml] },
    ];
}
