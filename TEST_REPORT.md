# TEST REPORT — png-squeeze-01-run-20261127

**Bounty:** Squeeze screenshots into the smallest PNG, 27 November 2026
(slug `png-squeeze-01-run-20261127`, hadiah $100, 50 tempat)
**Akun make.fun:** @budi-hertanto
**Entry yang diuji:** `main.ts` commit builder `0867706a90f23dec9710a59e4b346b5139349d27`
**Tester:** independen, 27 Nov 2026 ~12:20–12:35 WIB
**Kit:** `~/workspace/makefun/png-squeeze-01-kit/png-squeeze-01-run-20261127-kit/`
(RULES.txt + competition.yaml + rules/instance.yaml dibaca sebelum menguji)

## VERDICT: BERSIH — layak lanjut ke repo GitHub + bundle + submit

Tidak ada cacat KRITIS. Semua klaim builder terverifikasi secara independen
(skor, determinisme, waktu, baseline). Dua catatan di bawah (1 SEDANG, 1 KECIL)
tidak menghalangi submit.

## 1. Skor practice set (scorer kit, dijalankan ulang dari nol)

Perintah: `MAKEFUN_INPUT_DIR=<kit>/practice/input MAKEFUN_OUTPUT_DIR=/tmp/out1
node main.ts`, lalu scorer kit
`MAKEFUN_OUTPUT_DIR=/tmp/out1 MAKEFUN_REFERENCE_DIR=<kit>/practice/reference
MAKEFUN_SCORES_DIR=/tmp/scores1 node <kit>/program/scorer/score.ts`.

| instance | bytes | scale | floor | target | poin (×1.000) | status |
|---|---|---|---|---|---|---|
| i001 | 12.496 | 13.547 | 27.094 | 6.773 | 718.370 | exact |
| i002 | 52.273 | 55.063 | 110.126 | 27.531 | 700.442 | exact |
| i003 | 100.331 | 107.892 | 215.784 | 53.946 | 713.386 | exact |
| i004 | 100.838 | 110.521 | 221.042 | 55.260 | 725.073 | exact |
| i005 | 16.552 | 18.669 | 37.338 | 9.334 | 742.251 | exact |
| i006 | 171.291 | 185.295 | 370.590 | 92.647 | 717.050 | exact |
| i007 | 60.890 | 64.285 | 128.570 | 32.142 | 701.871 | exact |
| i008 | 24.809 | 26.807 | 53.614 | 13.403 | 716.346 | exact |

- **Skor total: 716.849 / 1.000.000 — passed=1, answered=8/8, semua exact.**
  Identik digit-per-digit dengan klaim builder. Semua jawaban < scale_bytes
  (0,90–0,94× scale).
- **Baseline house fixed-paeth 1.0.0 dijalankan ulang independen** dari
  `baselines/fixed-paeth/main.ts` + scorer kit: **420.399** — cocok dengan
  klaim builder. Entry mengungguli baseline **+296.450 poin (+70,5%)**.
  Syarat hadiah (skor > baseline) terpenuhi dengan margin besar.

## 2. Determinisme (byte-identical, 4 run)

- Run 1 → `/tmp/out1`, run 2 → `/tmp/out2`: `cmp` identik i001–i008.
- Run 3 (pengukuran memori) → `/tmp/out3`: identik dengan run 1.
- Run 4 (heap dibatasi `--max-old-space-size=256`) → `/tmp/out4`: identik
  dengan run 1.
- **4 run penuh, semua 8 instance byte-identical.** Syarat "dua eksekusi
  menulis byte yang sama" terpenuhi.

## 3. Waktu run (batas grader 60 dtk, satu wall untuk 8 instance)

- Run 1: 31,5 dtk · Run 2: 31,5 dtk · Run 3: 31,7 dtk ·
  Run 4 (heap 256 MB): 32,5 dtk.
- Sesuai klaim builder (31,9 / 31,2 dtk). Margin ~2× terhadap batas 60 dtk.
- Catatan: run ini single-thread CPU-bound (wall ≈ CPU time); kecepatan CPU
  grader bisa berbeda, dan set final yang lebih kaya bisa sedikit lebih
  lambat — margin 2× masih sehat.

## 4. Memori (batas grader 512 MB)

- Peak RSS terukur (python `resource.getrusage`, anak proses node):
  **322,8 MB** (run normal), **304,2 MB** (dengan `--max-old-space-size=256`).
- Lolos batas 512 MB dengan headroom ~190 MB, dan lolos uji heap 256 MB
  dengan output tetap byte-identical.
- Lihat catatan SEDANG di bawah soal klaim builder.

## 5. Validitas output PNG (pemeriksaan independen, bukan checker kit)

Skrip `/tmp/validate_png.mjs`: walk chunk manual + cek CRC + `zlib.inflateSync`
+ cek panjang data hasil inflate. Hasil **ALL PNG VALID**:

| instance | bytes | colour type | chunks | bit depth | interlace |
|---|---|---|---|---|---|
| i001 | 12.496 | 3 (palette) | IHDR,PLTE,IDAT,IEND | 8 | 0 |
| i002 | 52.273 | 2 (RGB) | IHDR,IDAT,IEND | 8 | 0 |
| i003 | 100.331 | 6 (RGBA) | IHDR,IDAT,IEND | 8 | 0 |
| i004 | 100.838 | 0 (grey) | IHDR,IDAT,IEND | 8 | 0 |
| i005 | 16.552 | 3 (palette) | IHDR,PLTE,IDAT,IEND | 8 | 0 |
| i006 | 171.291 | 2 (RGB) | IHDR,IDAT,IEND | 8 | 0 |
| i007 | 60.890 | 6 (RGBA) | IHDR,IDAT,IEND | 8 | 0 |
| i008 | 24.809 | 0 (grey) | IHDR,IDAT,IEND | 8 | 0 |

Semua: dimensi 1280×720, hanya chunk yang diizinkan (IHDR/PLTE/IDAT/IEND),
CRC benar, satu stream zlib per file, panjang inflate tepat
`720 × (1 + 1280 × bpp)`. PLTE hanya pada colour type 3. Scorer kit juga
menerima semua 8 sebagai "exact" (artinya piksel identik termasuk warna
piksel transparan penuh).

## 6. Ukuran repo (batas 1 MiB = 1.048.576 byte)

File ter-track git: main.ts 38.797 + LICENSE 1.065 + BUILD_REPORT.md 5.997 +
`.makefun/owner.json` 57 = **45.916 byte** (gaya grader: file + path =
45.964 byte). Jauh di bawah batas. LICENSE byte-identik dengan starter kit
(grader menghitungnya 0). Lihat catatan KECIL soal angka builder.

## 7. Kepatuhan (diperiksa dari kode + perilaku)

- **Runtime:** hanya modul bawaan Node (`node:fs`, `node:path`, `node:zlib`);
  tanpa dependensi, tanpa install saat runtime. ✅
- **Erasable TS saja:** tidak ada `enum`/`namespace`/decorator/parameter
  property/`declare`/`abstract`; `node --check main.ts` lolos; tidak ada
  `interface`/`type` declaration. ✅
- **Determinisme kode:** tidak ada `Date.now`/`performance.now`/
  `Math.random`/network/`child_process`; satu-satunya `process.env` adalah
  `MAKEFUN_INPUT_DIR`/`MAKEFUN_OUTPUT_DIR` dengan default `/input`/`/output`
  — pola yang sama persis dengan starter kit. ✅
- **Akses file:** hanya baca `INPUT_DIR/<id>/image.png`, hanya tulis
  `OUTPUT_DIR/<id>/image.png` (mkdir recursive). Tidak membaca file di luar
  `/input`, `/bot`, `/output`, `/tmp`. ✅
- **File kit/vendor tidak diubah:** kit tersegel (mtime 1970-01-01, sebelum
  pekerjaan builder); repo hanya berisi main.ts, LICENSE, BUILD_REPORT.md,
  `.makefun/owner.json` — tidak ada file kit/vendor di repo. ✅
- **Kode ditulis sendiri:** implementasi from-scratch (decoder PNG, filter
  search, deflate optimal-parsing gaya zopfli dari konsep); tidak ada file
  salinan entry lain di repo. (Tidak ada cara membuktikan negatif penuh dari
  luar, tapi struktur kode konsisten dengan klaim.) ✅
- **`.makefun/owner.json`:** wallet `5XrS76uzjrhf9pyMBVQpfL1SpyxX7Dk8vyFUncED2o39`
  hadir. ✅

## Catatan (tidak menghalangi)

### SEDANG — Klaim memori builder tidak akurat, tapi batas tetap lolos
BUILD_REPORT.md menyebut "buffer terbesar ~3,7 MB per gambar + tabel hash"
dan menyiratkan pemakaian jauh di bawah 512 MB. Pengukuran independen:
**peak RSS 322,8 MB** (304,2 MB dengan heap dibatasi 256 MB). Tetap lolos
batas 512 MB dengan headroom ~190 MB, dan uji heap-terbatas membuktikan
program tidak bergantung pada heap besar — jadi ini BUKAN blocker. Tapi
klaim "jauh di bawah" menyesatkan; angka yang benar adalah ~323 MB peak RSS.
Risiko sisa: bila set final jauh lebih kaya, pemakaian bisa naik; tidak ada
cara mengujinya sebelum set digambar. Tidak perlu perbaikan sebelum submit.

### KECIL — Angka ukuran repo builder tidak mencakup BUILD_REPORT.md
Builder menulis "ukuran repo 39.919 byte" (main.ts + LICENSE + owner.json
saja). Total sebenarnya saat ini **45.916 byte** (termasuk BUILD_REPORT.md
5.997 byte; setelah TEST_REPORT.md ini ditambahkan, ~52 KB). Tetap jauh di
bawah 1 MiB — tidak ada tindakan yang diperlukan.

## Yang TIDAK diuji (batas verifikasi — jujur dicatat)

- `grade-local` resmi kit (butuh Docker; tidak dijalankan — verifikasi memakai
  main.ts langsung + scorer kit yang sama komponennya).
- Skor pada **scored set** (round drand 34375212, digambar setelah deadline
  29 Nov 2026 12:00 WIB) — tidak bisa diketahui sebelum final.
- Node 22 persis grader: mesin ini **Node v24.22.1**; main.ts hanya memakai
  erasable TS + modul bawaan, kompatibel Node 22.18+ menurut builder.
- Kecepatan CPU grader (1 CPU, kontainer 512 MB): diuji lewat heap-terbatas
  (lolos), tapi cgroup 512 MB tidak bisa dibuat di mesin ini (tidak ada izin
  tulis `/sys/fs/cgroup`).
- `makefun check` / bundle / submit — langkah berikutnya, bukan tester.

## Rekomendasi langkah berikut

Lanjut ke repo GitHub (akun `financehubmanager`) + push + bundle +
`makefun check` + submit otomatis. Tidak ada perbaikan kode yang diminta
tester.
