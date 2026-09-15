// ============================================================
// pages/laporan.js — Laporan Keuangan: Neraca Saldo, Laba Rugi, Neraca
// (Balance Sheet), dan Laporan Perubahan Ekuitas. SEMUANYA dihitung
// real-time dari akun (pages/akun.js) + jurnal_detail (pages/jurnal.js)
// — tidak ada tabel/field tersendiri untuk hasil laporan, konsisten
// dengan prinsip satu sumber kebenaran (data tidak disimpan ganda).
// Reuse komponen render generik yang sudah ada (statGrid/article/
// articleFull/table, lihat engine.js) — tidak ada komponen baru.
// ============================================================
web.routes.laporan = 'resolveLaporan';

const laporanPage = {
    /** Hitung saldo tiap akun: { akun, totalDebit, totalKredit, saldoAkhir }.
     *  saldoAkhir = saldoAwal akun + pergerakan SEARAH saldo normalnya. */
    async hitungSaldoAkun() {
        const [akunList, jurnalDetailList] = await Promise.all([
            db.query('akun', () => true),
            db.query('jurnal_detail', () => true),
        ]);
        return akunList.map(akun => {
            const baris = jurnalDetailList.filter(d => d.akunId === akun.id);
            const totalDebit = baris.reduce((s, b) => s + (b.debit || 0), 0);
            const totalKredit = baris.reduce((s, b) => s + (b.kredit || 0), 0);
            const pergerakan = akun.saldoNormal === 'debit' ? (totalDebit - totalKredit) : (totalKredit - totalDebit);
            return { akun, totalDebit, totalKredit, saldoAkhir: (akun.saldoAwal || 0) + pergerakan };
        });
    },

    menuHtml(jenisAktif) {
        const item = (jenis, label) =>
            `<button type="button" class="catcart-chip ${jenisAktif === jenis ? 'active' : ''}" onclick="web.navigate('laporan/${jenis}')">${label}</button>`;
        return `<div class="catcart-chips">
            ${item('neraca-saldo', 'Neraca Saldo')}
            ${item('laba-rugi', 'Laba Rugi')}
            ${item('neraca', 'Neraca')}
            ${item('ekuitas', 'Perubahan Ekuitas')}
        </div>`;
    },

    blokNeracaSaldo(saldoList, menu) {
        const rows = saldoList
            .filter(s => s.totalDebit || s.totalKredit || s.akun.saldoAwal)
            .sort((a, b) => a.akun.kode.localeCompare(b.akun.kode));
        const totalDebit = rows.reduce((s, r) => s + r.totalDebit, 0);
        const totalKredit = rows.reduce((s, r) => s + r.totalKredit, 0);

        const tableRows = rows.map(r => ({
            Kode: r.akun.kode,
            Akun: r.akun.nama,
            Debit: formatRupiah(r.totalDebit),
            Kredit: formatRupiah(r.totalKredit),
            Saldo: `${formatRupiah(Math.abs(r.saldoAkhir))} ${r.saldoAkhir < 0 ? '(Kontra)' : ''}`,
        }));

        return [
            { section: 'titleHero', title: 'Laporan Keuangan', description: 'Neraca Saldo — rekap seluruh mutasi debit/kredit per akun dari jurnal.' },
            { section: 'articleFull', lines: [menu] },
            {
                section: 'statGrid',
                stats: [
                    { value: formatRupiah(totalDebit), label: 'Total Debit' },
                    { value: formatRupiah(totalKredit), label: 'Total Kredit' },
                    { value: Math.abs(totalDebit - totalKredit) < 1 ? 'Seimbang ✓' : 'TIDAK SEIMBANG', label: 'Status' },
                ],
            },
            { section: 'articleFull', subtitle: 'Neraca Saldo', lines: [`table:${JSON.stringify(tableRows)}`], emptyText: 'Belum ada mutasi jurnal.' },
        ];
    },

    blokLabaRugi(saldoList, menu) {
        const pendapatan = saldoList.filter(s => s.akun.tipe === 'pendapatan');
        const beban = saldoList.filter(s => s.akun.tipe === 'beban');
        const totalPendapatan = pendapatan.reduce((s, r) => s + r.saldoAkhir, 0);
        const totalBeban = beban.reduce((s, r) => s + r.saldoAkhir, 0);
        const labaBersih = totalPendapatan - totalBeban;

        const barisPendapatan = pendapatan.map(r => ({ Akun: `${r.akun.kode} — ${r.akun.nama}`, Jumlah: formatRupiah(r.saldoAkhir) }));
        const barisBeban = beban.map(r => ({ Akun: `${r.akun.kode} — ${r.akun.nama}`, Jumlah: formatRupiah(r.saldoAkhir) }));

        return [
            { section: 'titleHero', title: 'Laporan Keuangan', description: 'Laba Rugi — Pendapatan dikurangi Beban sejak akun-akun ini mulai dipakai.' },
            { section: 'articleFull', lines: [menu] },
            {
                section: 'statGrid',
                stats: [
                    { value: formatRupiah(totalPendapatan), label: 'Total Pendapatan' },
                    { value: formatRupiah(totalBeban), label: 'Total Beban' },
                    { value: formatRupiah(Math.abs(labaBersih)), label: labaBersih >= 0 ? 'Laba Bersih' : 'Rugi Bersih' },
                ],
            },
            {
                section: 'article',
                leftCol: { subtitle: 'Pendapatan', lines: [`table:${JSON.stringify(barisPendapatan)}`], emptyText: 'Belum ada pendapatan tercatat.' },
                rightCol: { subtitle: 'Beban', lines: [`table:${JSON.stringify(barisBeban)}`], emptyText: 'Belum ada beban tercatat.' },
            },
        ];
    },

    blokNeraca(saldoList, menu) {
        const aset = saldoList.filter(s => s.akun.tipe === 'aset');
        const kewajiban = saldoList.filter(s => s.akun.tipe === 'kewajiban');
        const ekuitas = saldoList.filter(s => s.akun.tipe === 'ekuitas');
        const pendapatan = saldoList.filter(s => s.akun.tipe === 'pendapatan').reduce((s, r) => s + r.saldoAkhir, 0);
        const beban = saldoList.filter(s => s.akun.tipe === 'beban').reduce((s, r) => s + r.saldoAkhir, 0);
        const labaBerjalan = pendapatan - beban;

        const totalAset = aset.reduce((s, r) => s + r.saldoAkhir, 0);
        const totalKewajiban = kewajiban.reduce((s, r) => s + r.saldoAkhir, 0);
        const totalEkuitas = ekuitas.reduce((s, r) => s + r.saldoAkhir, 0) + labaBerjalan;
        const seimbang = Math.abs(totalAset - (totalKewajiban + totalEkuitas)) < 1;

        const barisAset = aset.map(r => ({ Akun: `${r.akun.kode} — ${r.akun.nama}`, Jumlah: formatRupiah(r.saldoAkhir) }));
        const barisKewajiban = kewajiban.map(r => ({ Akun: `${r.akun.kode} — ${r.akun.nama}`, Jumlah: formatRupiah(r.saldoAkhir) }));
        const barisEkuitas = [
            ...ekuitas.map(r => ({ Akun: `${r.akun.kode} — ${r.akun.nama}`, Jumlah: formatRupiah(r.saldoAkhir) })),
            { Akun: 'Laba (Rugi) Tahun Berjalan', Jumlah: formatRupiah(labaBerjalan) },
        ];

        return [
            { section: 'titleHero', title: 'Laporan Keuangan', description: 'Neraca (Balance Sheet) — posisi keuangan saat ini: Aset = Kewajiban + Ekuitas.' },
            { section: 'articleFull', lines: [menu] },
            {
                section: 'statGrid',
                stats: [
                    { value: formatRupiah(totalAset), label: 'Total Aset' },
                    { value: formatRupiah(totalKewajiban + totalEkuitas), label: 'Total Kewajiban + Ekuitas' },
                    { value: seimbang ? 'Seimbang ✓' : 'TIDAK SEIMBANG', label: 'Status' },
                ],
            },
            {
                section: 'article',
                leftCol: { subtitle: `Aset (${formatRupiah(totalAset)})`, lines: [`table:${JSON.stringify(barisAset)}`], emptyText: 'Belum ada akun aset dengan saldo.' },
                rightCol: {
                    subtitle: `Kewajiban (${formatRupiah(totalKewajiban)}) &amp; Ekuitas (${formatRupiah(totalEkuitas)})`,
                    lines: [
                        '### Kewajiban',
                        `table:${JSON.stringify(barisKewajiban)}`,
                        '### Ekuitas',
                        `table:${JSON.stringify(barisEkuitas)}`,
                    ],
                },
            },
        ];
    },

    blokEkuitas(saldoList, menu) {
        const ekuitas = saldoList.filter(s => s.akun.tipe === 'ekuitas');
        const modalAwal = ekuitas.reduce((s, r) => s + (r.akun.saldoAwal || 0), 0);
        // Pergerakan akun ekuitas SELAIN saldo awal (mis. setoran modal tambahan / prive lewat jurnal manual).
        const pergerakanLain = ekuitas.reduce((s, r) => s + (r.saldoAkhir - (r.akun.saldoAwal || 0)), 0);
        const pendapatan = saldoList.filter(s => s.akun.tipe === 'pendapatan').reduce((s, r) => s + r.saldoAkhir, 0);
        const beban = saldoList.filter(s => s.akun.tipe === 'beban').reduce((s, r) => s + r.saldoAkhir, 0);
        const labaBerjalan = pendapatan - beban;
        const modalAkhir = modalAwal + pergerakanLain + labaBerjalan;

        const tableRows = [
            { Komponen: 'Modal Awal', Jumlah: formatRupiah(modalAwal) },
            { Komponen: 'Setoran / Penarikan Modal (Prive) Periode Berjalan', Jumlah: formatRupiah(pergerakanLain) },
            { Komponen: 'Laba (Rugi) Tahun Berjalan', Jumlah: formatRupiah(labaBerjalan) },
            { Komponen: 'Modal Akhir', Jumlah: formatRupiah(modalAkhir) },
        ];

        return [
            { section: 'titleHero', title: 'Laporan Keuangan', description: 'Laporan Perubahan Ekuitas — pergerakan modal pemilik dari saldo awal hingga saat ini.' },
            { section: 'articleFull', lines: [menu] },
            { section: 'articleFull', subtitle: 'Perubahan Ekuitas', lines: [`table:${JSON.stringify(tableRows)}`] },
        ];
    },
};

async function resolveLaporan(sub) {
    const guard = requireLogin(['owner']);
    if (guard) return guard;

    const jenis = sub || 'neraca-saldo';
    const saldoList = await laporanPage.hitungSaldoAkun();
    const menu = laporanPage.menuHtml(jenis);

    if (jenis === 'laba-rugi') return laporanPage.blokLabaRugi(saldoList, menu);
    if (jenis === 'neraca') return laporanPage.blokNeraca(saldoList, menu);
    if (jenis === 'ekuitas') return laporanPage.blokEkuitas(saldoList, menu);
    return laporanPage.blokNeracaSaldo(saldoList, menu);
}
