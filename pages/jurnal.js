// ============================================================
// pages/jurnal.js — Jurnal Umum (general journal): baris-baris akun
// yang harus SEIMBANG (total debit = total kredit). Dipakai lewat DUA
// jalur:
//   1) INPUT MANUAL   -> jurnalPage.bukaForm() (mis. setoran modal,
//      prive, beban operasional non-transaksi).
//   2) POSTING OTOMATIS -> jurnalPage.postingTransaksi(...), dipanggil
//      dari cfg.afterConfirm milik createInstantDocumentPage (lihat
//      pages/shared.js) di kasir.js & transaksi.js. Hook afterConfirm
//      SUDAH ADA sebelumnya (dipakai utk pembayaran QRIS) — modul ini
//      cuma MENAMBAH panggilan baru di hook yang sama, TIDAK menyentuh
//      shared.js sama sekali. Konsisten dengan prinsip DRY/reuse yang
//      sudah dipegang di seluruh aplikasi ini.
//
// Sama seperti kasir/transaksi/distribusi: begitu baris seimbang,
// langsung status 'posted' — tidak ada draft->posting manual terpisah.
//
// [SECURITY] Form input manual jurnal (bukaForm) TETAP dalam drawer,
// hanya markupnya dirakit manual (bodyHtml) karena tabel baris perlu
// tambah/hapus baris dinamis — bukan pengecualian dari aturan "semua
// form dalam drawer". Nilai b.keterangan & opsi akun (a.kode/a.nama,
// keduanya bisa diisi bebas lewat form Akun) di-escHtml() sebelum masuk
// atribut/isi tag, karena baris ini dirender ulang tiap kali pengguna
// mengetik (renderBarisForm) — tanpa escaping, XSS bisa langsung
// tereksekusi SAAT MENGETIK di form ini sendiri.
// ============================================================
web.routes.jurnal = 'resolveJurnal';

const jurnalPage = {
    baris: [],   // { akunId, debit, kredit, keterangan }
    akunList: [],

    // ------------------------------------------------------------
    // Form input manual — tabel baris dinamis (tambah/hapus baris)
    // ------------------------------------------------------------
    resetBaris() {
        this.baris = [
            { akunId: '', debit: 0, kredit: 0, keterangan: '' },
            { akunId: '', debit: 0, kredit: 0, keterangan: '' },
        ];
    },

    tambahBaris() {
        this.baris.push({ akunId: '', debit: 0, kredit: 0, keterangan: '' });
        this.renderBarisForm();
    },

    hapusBaris(i) {
        if (this.baris.length <= 2) return alert('Jurnal minimal punya 2 baris (sisi debit & sisi kredit).');
        this.baris.splice(i, 1);
        this.renderBarisForm();
    },

    ubahBaris(i, field, value) {
        if (field === 'debit' || field === 'kredit') {
            this.baris[i][field] = parseFloat(value) || 0;
            // 1 baris hanya boleh salah satu: isi debit otomatis nolkan kredit, & sebaliknya.
            if (field === 'debit' && this.baris[i].debit) this.baris[i].kredit = 0;
            if (field === 'kredit' && this.baris[i].kredit) this.baris[i].debit = 0;
        } else {
            this.baris[i][field] = value;
        }
        this.updateTotalBar();
    },

    totalDebit() { return this.baris.reduce((s, b) => s + (b.debit || 0), 0); },
    totalKredit() { return this.baris.reduce((s, b) => s + (b.kredit || 0), 0); },
    seimbang() { return this.totalDebit() > 0 && Math.abs(this.totalDebit() - this.totalKredit()) < 0.01; },

    updateTotalBar() {
        const bar = web.gebi('jurnalTotalBar');
        if (bar) bar.innerHTML = this.totalBarHtml();
    },

    totalBarHtml() {
        const seimbang = this.seimbang();
        const selisih = Math.abs(this.totalDebit() - this.totalKredit());
        return `<div class="catcart-header-bar">
            <strong>Total Debit: ${formatRupiah(this.totalDebit())}</strong>
            <strong>Total Kredit: ${formatRupiah(this.totalKredit())}</strong>
            <strong style="color:${seimbang ? 'green' : '#c0392b'}">${seimbang ? 'Seimbang ✓' : `Selisih ${formatRupiah(selisih)}`}</strong>
        </div>`;
    },

    barisRowHtml(b, i) {
        const opts = this.akunList
            .filter(a => a.aktif)
            .map(a => `<option value="${escHtml(a.id)}" ${a.id === b.akunId ? 'selected' : ''}>${escHtml(a.kode)} — ${escHtml(a.nama)}</option>`)
            .join('');
        return `<tr>
            <td><select onchange="jurnalPage.ubahBaris(${i},'akunId',this.value)"><option value="">— pilih akun —</option>${opts}</select></td>
            <td><input type="text" value="${escHtml(b.keterangan)}" oninput="jurnalPage.ubahBaris(${i},'keterangan',this.value)" placeholder="opsional"></td>
            <td><input type="number" min="0" step="any" value="${b.debit || ''}" oninput="jurnalPage.ubahBaris(${i},'debit',this.value)"></td>
            <td><input type="number" min="0" step="any" value="${b.kredit || ''}" oninput="jurnalPage.ubahBaris(${i},'kredit',this.value)"></td>
            <td><button type="button" class="catcart-cart-row-hapus" onclick="jurnalPage.hapusBaris(${i})">&times;</button></td>
        </tr>`;
    },

    barisFormHtml() {
        return `<div class="table-container"><table>
                <thead><tr><th>Akun</th><th>Keterangan</th><th>Debit</th><th>Kredit</th><th></th></tr></thead>
                <tbody>${this.baris.map((b, i) => this.barisRowHtml(b, i)).join('')}</tbody>
            </table></div>
            <button type="button" class="slcBtn" style="background:#555" onclick="jurnalPage.tambahBaris()">+ Baris</button>
            <div id="jurnalTotalBar">${this.totalBarHtml()}</div>`;
    },

    renderBarisForm() {
        const wrap = web.gebi('jurnalBarisWrap');
        if (wrap) wrap.innerHTML = this.barisFormHtml();
    },

    // Markup form dirakit manual (bodyHtml) karena butuh tabel baris
    // dinamis — TETAP dibuka lewat web.openDrawer() seperti form lainnya.
    bukaForm() {
        this.resetBaris();
        web.openDrawer({
            title: 'Input Jurnal Umum',
            bodyHtml: `
                <form onsubmit="event.preventDefault(); jurnalPage.simpanManual(this);">
                    <div class="a-row"><label>Tanggal</label>
                        <input type="date" name="tanggal" value="${new Date().toISOString().slice(0, 10)}" required></div>
                    <div class="a-row"><label>Keterangan</label>
                        <input type="text" name="keterangan" placeholder="mis. Setoran modal awal / Bayar listrik" required maxlength="200"></div>
                    <div id="jurnalBarisWrap">${this.barisFormHtml()}</div>
                    <button type="submit" class="slcBtn">Simpan Jurnal</button>
                </form>`,
        });
    },

    async simpanManual(form) {
        if (this.baris.some(b => !b.akunId)) return alert('Semua baris wajib memilih akun.');
        if (!this.seimbang()) return alert('Total debit harus sama dengan total kredit (dan lebih dari 0) sebelum disimpan.');
        const tanggal = form.querySelector('[name="tanggal"]').value;
        const keterangan = form.querySelector('[name="keterangan"]').value.trim();

        try {
            await this.simpan({ tanggal, keterangan, sumber: 'manual', referensiId: null }, this.baris);
        } catch (err) { return alert('Gagal menyimpan jurnal: ' + err.message); }

        web.closeDrawer();
        web.navigate('jurnal');
    },

    // ------------------------------------------------------------
    // Mesin simpan generik — SATU jalur dipakai baik oleh input manual
    // maupun posting otomatis (header + baris, pola sama dgn shared.js).
    // header: { tanggal, keterangan, sumber, referensiId }
    // baris:  [{ akunId, debit, kredit, keterangan }]
    // ------------------------------------------------------------
    async simpan(header, baris) {
        const jurnal = await db.insert('jurnal', {
            nomor: 'JU-' + Date.now().toString(36).toUpperCase(),
            tanggal: header.tanggal,
            sumber: header.sumber || 'manual',
            referensiId: header.referensiId || null,
            keterangan: header.keterangan || '',
            status: 'posted',
            createdAt: new Date().toISOString(),
        });
        for (const b of baris) {
            if (!b.akunId || (!b.debit && !b.kredit)) continue;
            await db.insert('jurnal_detail', {
                jurnalId: jurnal.id,
                akunId: b.akunId,
                debit: b.debit || 0,
                kredit: b.kredit || 0,
                keterangan: b.keterangan || '',
            });
        }
        return jurnal;
    },

    // ------------------------------------------------------------
    // POSTING OTOMATIS dari Transaksi jual/beli. Dipanggil dari hook
    // afterConfirm di kasir.js & transaksi.js dengan (header, cart, ctrl)
    // — argumen yang SAMA PERSIS dikirim shared.js ke afterConfirm, jadi
    // tidak perlu ubah signature apa pun di shared.js.
    //
    // Akun dicari lewat KODE baku (bukan id) — lihat catatan di seed
    // schema.sql: 1101 Kas, 1103 Piutang QRIS, 1104 Persediaan,
    // 2101 Utang Usaha, 4101 Penjualan, 5101 HPP. Kalau salah satu akun
    // belum ada di COA tenant, posting otomatis DILEWATI (bukan gagal —
    // supaya transaksi jual/beli tetap tersimpan walau modul keuangan
    // belum lengkap disiapkan pemilik toko).
    // ------------------------------------------------------------
    async postingTransaksi(header, cart, ctrl) {
        const akunList = await db.query('akun', a => a.aktif);
        const cari = (kode) => akunList.find(a => a.kode === kode);
        const produkById = Object.fromEntries((ctrl?.produkList || []).map(p => [p.id, p]));

        const persediaan = cari('1104');

        if (header.tipe === 'jual') {
            const kas = cari(header.metodePembayaran === 'qris' ? '1103' : '1101');
            const penjualan = cari('4101');
            const hpp = cari('5101');
            if (!kas || !penjualan) return;

            const totalHpp = cart.reduce((s, c) => s + c.qty * (produkById[c.produkId]?.hargaBeli || 0), 0);
            const baris = [
                { akunId: kas.id, debit: header.totalBayar, kredit: 0, keterangan: `Penjualan ${header.nomor}` },
                { akunId: penjualan.id, debit: 0, kredit: header.totalBayar, keterangan: `Penjualan ${header.nomor}` },
            ];
            if (hpp && persediaan && totalHpp > 0) {
                baris.push({ akunId: hpp.id, debit: totalHpp, kredit: 0, keterangan: `HPP ${header.nomor}` });
                baris.push({ akunId: persediaan.id, debit: 0, kredit: totalHpp, keterangan: `HPP ${header.nomor}` });
            }
            await this.simpan({ tanggal: header.tanggal, keterangan: `Posting otomatis — Transaksi Jual ${header.nomor}`, sumber: 'transaksi', referensiId: header.id }, baris);

        } else if (header.tipe === 'beli') {
            const lawan = cari(header.metodePembayaran === 'qris' ? '2101' : '1101'); // tunai=Kas berkurang, non-tunai=Utang Usaha bertambah
            if (!persediaan || !lawan) return;

            await this.simpan({ tanggal: header.tanggal, keterangan: `Posting otomatis — Transaksi Beli ${header.nomor}`, sumber: 'transaksi', referensiId: header.id }, [
                { akunId: persediaan.id, debit: header.totalBayar, kredit: 0, keterangan: `Pembelian ${header.nomor}` },
                { akunId: lawan.id, debit: 0, kredit: header.totalBayar, keterangan: `Pembelian ${header.nomor}` },
            ]);
        }
    },

    /** Reklasifikasi Piutang Usaha (QRIS) -> Kas saat pembayaran ditandai
     *  lunas — dipanggil dari qrisPage.tandaiLunas (pages/transaksi.js). */
    async postingPelunasanQris(payment) {
        const akunList = await db.query('akun', a => a.aktif);
        const kas = akunList.find(a => a.kode === '1101');
        const piutang = akunList.find(a => a.kode === '1103');
        if (!kas || !piutang || !payment?.jumlah) return;

        await this.simpan({
            tanggal: new Date().toISOString().slice(0, 10),
            keterangan: `Pelunasan QRIS ${payment.referensi || ''}`,
            sumber: 'pembayaran', referensiId: payment.id,
        }, [
            { akunId: kas.id, debit: payment.jumlah, kredit: 0 },
            { akunId: piutang.id, debit: 0, kredit: payment.jumlah },
        ]);
    },
};

async function resolveJurnal(sub) {
    const guard = requireLogin(['owner']);
    if (guard) return guard;

    if (sub && sub.startsWith('detail-')) return resolveJurnalDetail(sub.replace('detail-', ''));

    const [rows, akunList] = await Promise.all([
        db.query('jurnal', () => true),
        db.query('akun', () => true),
    ]);
    jurnalPage.akunList = akunList;

    const sumberBadge = { manual: '', transaksi: 'badge-success', pembayaran: 'badge-warning' };
    const jurnalDetailAll = await db.query('jurnal_detail', () => true);

    const tableRows = rows
        .sort((a, b) => (b.tanggal || '').localeCompare(a.tanggal || ''))
        .map(j => {
            const total = jurnalDetailAll.filter(d => d.jurnalId === j.id).reduce((s, b) => s + (b.debit || 0), 0);
            return {
                Nomor: j.nomor,
                Tanggal: j.tanggal,
                Sumber: `<span class="badge ${sumberBadge[j.sumber] || ''}">${escHtml(j.sumber)}</span>`,
                Keterangan: j.keterangan || '-',
                Jumlah: formatRupiah(total),
                Aksi: `<button class="slcBtn" onclick='web.navigate(${JSON.stringify('jurnal/detail-' + j.id)})'>Lihat</button>`,
            };
        });

    return [
        { section: 'titleHero', title: 'Jurnal Umum', description: 'Riwayat jurnal — otomatis dibuat dari transaksi jual/beli, atau diinput manual (setoran modal, prive, beban operasional, dll).' },
        {
            section: 'articleFull',
            subtitle: `Daftar Jurnal (${rows.length})`,
            lines: [
                `<button class="slcBtn" onclick="jurnalPage.bukaForm()">+ Input Jurnal Manual</button>
                 <button class="slcBtn" style="background:#555" onclick="web.navigate('akun')">Bagan Akun</button>
                 <button class="slcBtn" style="background:#555" onclick="web.navigate('laporan')">Laporan Keuangan</button>`,
                `table:${JSON.stringify(tableRows)}`,
            ],
            tableOpts: { rawKeys: ['Sumber', 'Aksi'] },
            emptyText: 'Belum ada jurnal. Jurnal akan muncul otomatis setelah ada transaksi jual/beli, atau bisa diinput manual.',
        },
    ];
}

async function resolveJurnalDetail(id) {
    const [jurnal, baris, akunList] = await Promise.all([
        db.find('jurnal', j => j.id === id),
        db.query('jurnal_detail', d => d.jurnalId === id),
        db.query('akun', () => true),
    ]);
    if (!jurnal) return [{ section: 'titleHero', title: 'Jurnal Tidak Ditemukan' }];
    const akunById = Object.fromEntries(akunList.map(a => [a.id, a]));

    const tableRows = baris.map(b => ({
        Akun: akunById[b.akunId] ? `${akunById[b.akunId].kode} — ${akunById[b.akunId].nama}` : '(akun terhapus)',
        Keterangan: b.keterangan || '-',
        Debit: b.debit ? formatRupiah(b.debit) : '-',
        Kredit: b.kredit ? formatRupiah(b.kredit) : '-',
    }));

    return [
        { section: 'titleHero', title: `Jurnal ${escHtml(jurnal.nomor)}`,
          description: `Tanggal: <strong>${escHtml(jurnal.tanggal)}</strong> &middot; Sumber: <strong>${escHtml(jurnal.sumber)}</strong>${jurnal.keterangan ? ` &middot; ${escHtml(jurnal.keterangan)}` : ''}` },
        {
            section: 'articleFull',
            subtitle: `Baris Jurnal (${baris.length})`,
            lines: [
                `<button class="slcBtn" style="background:#555" onclick="web.navigate('jurnal')">&larr; Kembali</button>`,
                `table:${JSON.stringify(tableRows)}`,
            ],
        },
    ];
}
