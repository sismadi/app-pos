// ============================================================
// pages/kasir.js — Layar Kasir: transaksi jual instan lewat mesin
// BERSAMA createInstantDocumentPage (pages/shared.js) — mesin yang
// SAMA PERSIS dipakai transaksi.js (jual/beli) & distribusi.js
// (masuk/keluar), supaya ketiganya benar-benar satu tampilan & satu
// alur: pilih Lokasi/Kontak di atas -> ketuk produk di katalog ->
// satu tombol "Bayar" langsung membuat transaksi + baris produk +
// penyesuaian stok + (kalau QRIS) baris pembayaran. Tidak ada lagi
// status draft manual — meniru alur kasir toko sungguhan.
// ============================================================
web.routes.kasir = 'resolveKasir';

const kasirPage = createInstantDocumentPage('kasirPage', {
    headerTable: 'transaksi', lineTable: 'transaksi_produk', headerIdField: 'transaksiId',
    nomorPrefix: () => 'TR-',
    detailRoute: () => 'transaksi/detail-',
    pageTitle: () => 'Kasir',
    pageDesc: () => 'Pilih lokasi & customer di atas, ketuk produk untuk menambah ke keranjang, lalu ketuk tombol keranjang di kanan-bawah untuk bayar.',
    lokasiLabel: () => 'Lokasi',
    kontakLabel: () => 'Customer',
    kontakEmptyLabel: () => 'umum / tanpa nama',
    kontakFilter: (k) => k.tipe === 'customer',
    getPrice: (p) => p.hargaJual || 0,
    allowPriceEdit: false,
    cartTitle: 'Keranjang',
    emptyCatalogMsg: 'Tidak ada produk yang cocok.',
    emptyCartMsg: 'Keranjang masih kosong. Ketuk produk di katalog untuk menambah.',
    extraFieldsHtml: () => `
        <div class="a-row"><label class="a-label">Bayar dengan</label>
            <select name="metodePembayaran">
                <option value="tunai">Tunai</option>
                <option value="qris">QRIS</option>
            </select></div>`,
    readExtra: (form) => ({ metodePembayaran: form.querySelector('[name="metodePembayaran"]')?.value || 'tunai' }),
    headerExtra: (ctrl, extra) => ({ metodePembayaran: extra.metodePembayaran, totalBayar: ctrl.total() }),
    lineExtra: (c) => ({ subtotal: c.qty * c.harga }),
    confirmLabel: (ctrl) => `Bayar ${formatRupiah(ctrl.total())}`,
    stockDelta: () => -1,
    afterConfirm: async (header, cart, tipe, ctrl) => {
        if (header.metodePembayaran === 'qris') await qrisPage.buatPembayaran(header.id, header.totalBayar);
        // Posting jurnal otomatis (Modul Keuangan) — mesin sama dgn transaksi.js, lihat pages/jurnal.js.
        await jurnalPage.postingTransaksi(header, cart, ctrl);
    },
});

async function resolveKasir() {
    const guard = requireLogin(['owner', 'kasir']);
    if (guard) return guard;

    await kasirPage.load('jual');
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

    return kasirPage.pageBlocks('jual');
}
