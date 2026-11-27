# BUILD REPORT — png-squeeze-01-run-20261127

**Bounty:** Squeeze screenshots into the smallest PNG, 27 November 2026
(slug `png-squeeze-01-run-20261127`, hadiah $100, 50 tempat)
**Akun make.fun:** @budi-hertanto
**Builder:** percobaan ke-3 (melanjutkan main.ts dari dua builder sebelumnya,
terakhir diubah 11:59 WIB; diverifikasi & diselesaikan 27 Nov 2026 ~12:15 WIB)
**Status: SIAP TESTER** — tidak ada blocker yang diketahui.

## Yang dibangun

`main.ts` (38.797 byte) — program Node 22 (erasable TS saja, hanya modul
bawaan Node, tanpa dependensi, tanpa install saat runtime) yang membaca
`/input/<id>/image.png` (8 instance 1280×720 RGBA) dan menulis
`/output/<id>/image.png` lossless.

Pendekatan kompresi (kode ditulis sendiri dari konsep; tidak menyalin kode
entry lain; tidak ada file kit/vendor yang diubah):

1. **Decoder PNG sendiri** (bit depth 8, colour type 0/2/3/4/6, filter 0–4,
   verifikasi CRC) → RGBA.
2. **Pemilihan bentuk warna per gambar** — palette (≤256 warna, dua urutan
   palette: by-count dan by-luminance), grey (0), grey+alpha (4), RGB (2),
   RGBA (6), plus kunci transparan via tRNS bila semua piksel transparan
   memakai satu nilai warna. Palette menang besar pada tema flat/grey.
3. **Pemilihan filter per baris** — fixed 0, min-sum (jumlah |signed|),
   fewest-pairs, dan `brute`: tiap baris dicoba 5 filter dan dipilih yang
   paling kecil setelah deflate level 4 (dengan dictionary 32 KB konteks
   sebelumnya). Fixed filter 1/2/4 tidak pernah menang di practice set
   sehingga tidak dicoba (hemat waktu).
4. **Encoder DEFLATE optimal-parsing buatan sendiri** (gaya zopfli, dari
   konsep): hash-chain LZ77 (chain 256, window 32 KB), DP shortest-path
   parse atas biaya bit eksak, Huffman length-limited via boundary
   package-merge (maks 15 bit), iterasi 3× (mulai dari fixed, lalu
   hitung ulang panjang kode dari token), blok 256 KB, pilih dynamic vs
   fixed block yang lebih kecil. Sebagai jaring pengaman, kandidat terbaik
   juga di-encode dengan zlib level 9 (3 strategi) dan runner-up dengan
   zlib level 9; PNG terkecil yang menang.
5. **Screening kandidat** dengan zlib level 6 (level 1 terbukti salah
   peringkat — pernah memilih kandidat 4,5% lebih buruk di i002).
6. **Deterministik penuh:** tanpa jam, tanpa random, jumlah kerja tetap
   per gambar. Output PNG hanya chunk IHDR/PLTE/tRNS/IDAT/IEND, bit depth 8,
   non-interlaced.

## Hasil verifikasi (practice set, kit scorer)

| instance | tema | bytes | scale | floor | target | poin (×1.000) |
|---|---|---|---|---|---|---|
| i001 | flat | 12.496 | 13.547 | 27.094 | 6.773 | 718.370 |
| i002 | rich | 52.273 | 55.063 | 110.126 | 27.531 | 700.442 |
| i003 | alpha | 100.331 | 107.892 | 215.784 | 53.946 | 713.386 |
| i004 | grey | 100.838 | 110.521 | 221.042 | 55.260 | 725.073 |
| i005 | flat | 16.552 | 18.669 | 37.338 | 9.334 | 742.251 |
| i006 | rich | 171.291 | 185.295 | 370.590 | 92.647 | 717.050 |
| i007 | alpha | 60.890 | 64.285 | 128.570 | 32.142 | 701.871 |
| i008 | grey | 24.809 | 26.807 | 53.614 | 13.403 | 716.346 |

- **Skor total: 716.849 / 1.000.000 — passed=1, answered=8/8, semua exact.**
- **Baseline house fixed-paeth 1.0.0 di practice set yang sama: 420.399**
  (dijalankan dari `baselines/fixed-paeth/main.ts`, skor via scorer kit).
  → Entry mengalahkan baseline **+296.450 poin (+70,5%)**. Syarat hadiah
  (skor > baseline) terpenuhi dengan margin besar.
- Semua 8 jawaban **lebih kecil dari scale_bytes** (0,90–0,94× scale).
  Referensi kit sendiri disebut meraih ~760–790/instance; entry ini
  700–742/instance — di bawah referensi, di atas baseline dengan jauh.
- **Determinisme:** 2 run penuh byte-identical di semua 8 instance
  (`cmp` identik i001–i008).
- **Waktu run:** 31,9 dtk dan 31,2 dtk (2 run, mesin ini, single-thread
  CPU-bound) — di bawah batas 60 dtk grader (1 CPU). Margin ~2×.
  Catatan: set final bisa sedikit lebih lambat bila gambarnya lebih kaya;
  tetap di bawah 60 dtk selama kompleksitasnya sekelas practice set.
- **Ukuran repo:** 39.919 byte total (main.ts 38.797 + LICENSE 1.065 +
  .makefun/owner.json 57) — jauh di bawah batas 1 MiB (1.048.576).
  File byte-identik starter dihitung 0 oleh grader; main.ts bukan starter.
- **Format output:** hanya chunk yang diizinkan, CRC benar (scorer kit
  menerima semua 8 sebagai exact).

## Eksperimen yang dicoba builder ke-3 (dan ditolak)

- Varian deflate CHAIN_LIMIT 1024 + DP_ITERATIONS 4 pada i006:
  170.502 byte vs 171.291 (−0,46%) tapi waktu 7,3 dtk untuk 1 instance
  (vs ~4 dtk rata-rata) — gain tidak sepadan dengan risiko batas 60 dtk.
  **Tidak diterapkan; konstanta tetap CHAIN_LIMIT=256, DP_ITERATIONS=3.**

## File

- `main.ts` — entry (38.797 byte)
- `LICENSE` — MIT (1.065 byte)
- `.makefun/owner.json` — claim wallet akun (57 byte)
- `BUILD_REPORT.md` — laporan ini

## Yang belum diverifikasi

- `grade-local` resmi kit (butuh Docker; tidak dijalankan — verifikasi
  dilakukan dengan menjalankan main.ts langsung + scorer kit
  `program/scorer/score.ts`, yang merupakan komponen yang sama dengan
  yang dipakai grade-local).
- Skor pada **scored set** (round drand 34375212, digambar setelah
  deadline 29 Nov 2026 12:00 WIB) — tidak bisa diketahui sebelum final.
- `makefun check` / submit — langkah berikutnya, bukan builder.
- Uji di Node 22 persis grader (mesin ini Node v24.22.1; main.ts hanya
  memakai erasable TS + modul bawaan, kompatibel Node 22.18+).
- Uji batas memori 512 MB grader (pemakaian di sini jauh di bawah itu:
  buffer terbesar ~3,7 MB per gambar + tabel hash).

## Catatan untuk tester

- Perintah uji: `MAKEFUN_INPUT_DIR=<kit>/practice/input
  MAKEFUN_OUTPUT_DIR=/tmp/out node main.ts`, lalu scorer dengan
  `MAKEFUN_OUTPUT_DIR=/tmp/out MAKEFUN_REFERENCE_DIR=<kit>/practice/reference
  MAKEFUN_SCORES_DIR=/tmp/scores node <kit>/program/scorer/score.ts`.
- Perhatian utama: waktu run di CPU tunggal (31–32 dtk di sini) dan
  apakah ada instance final yang jauh lebih lambat.
