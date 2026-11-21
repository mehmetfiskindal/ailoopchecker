---
name: ailoopchecker-forensic-analyzers
description: >-
  Add, modify, or tune forensic media analyzers (image, video, audio, text),
  binary parsers, pixel/DSP signal heuristics, and scoring rules in
  ailoopchecker. Use when supporting a new media format, adding a forensic
  metric or finding, tuning thresholds, or adding synthetic test fixtures.
---

# Developing Forensic Analyzers in ailoopchecker

Use this runbook when adding or improving binary container parsers, pixel/DSP forensic algorithms, or stylometric detectors in `src/analyzers/`.

## Module Map (4-Layer Architecture)

- **Shared (`src/shared/`):** `types.ts`, `bytes.ts` (magic-byte format detection, endian readers, O(N) `indexOfUtf8CI`), `inflate.ts` (pure TS zlib inflate).
- **Core (`src/core/`):** `signatures.ts`, `scoring.ts`, `analyzer.ts`, `project-audit.ts`.
- **Features (`src/features/`):**
  - `src/features/image/analyzer.ts` — PNG (`IHDR`, `tEXt`, `zTXt`, `iTXt`, `eXIf`, `caBX`, `IDAT` pixel unfiltering), JPEG (`SOF0/2`, `APP1` EXIF+XMP, `APP11`, `DQT`, `COM`), WebP, BMP, GIF; 2D Laplacian & upsampler autocorrelation.
  - `src/features/video/analyzer.ts` — Recursive ISO Base Media (`MP4`/`MOV`) box parser, WebM/MKV EBML scan, AVI RIFF parser, `4k+1` temporal VAE frame counts, `stts`/`stsz`/`stss` variance.
  - `src/features/audio/analyzer.ts` — WAV RIFF + PCM/Float decoder, native 1024-point Radix-2 Hann-windowed STFT/FFT, MP3 ID3v2/ID3v1/MPEG frame parser, FLAC/OGG/Opus/M4A metadata.
  - `src/features/code/analyzer.ts` — Multi-language source code & AI-loop forensic analyzer (21 modern languages + shebang).
  - `src/features/text/analyzer.ts` — Turkish & English O(N) byte-level stylometry.
- **Product (`src/product/`):** `cli.ts`, `report.ts`, `selftest.ts` (12 synthetic file + project tests), `index.ts` (SDK).

## Procedure for Adding a New Forensic Rule or Format

1. **Format detection first (`src/bytes.ts`):**
   - Detect by magic bytes, not file extension alone. Fall back to extension only for ambiguous containers (e.g., `.m4a` vs `.mp4`, `.mov` vs `.mp4`, or text extensions).
2. **Add defensive resource caps:**
   - Check buffer bounds before every read.
   - Bound loops, recursion depth, decompressed byte sizes, pixel counts, and audio sample counts. See [references/scoring-and-limits.md](./references/scoring-and-limits.md).
3. **Emit bilingual `ForensicFinding` entries:**
   - Every finding MUST populate `id`, `category`, `severity`, `scoreDelta`, `titleTr`, `titleEn`, `detailTr`, `detailEn`, and concise `evidence`.
   - Record raw numbers in `metrics` (`KeyValueEntry[]`) and extracted header fields in `metadata` (`KeyValueEntry[]`).
4. **Calibrate weights carefully:**
   - Soft heuristics (`scoreDelta`: `+7` to `+18`) must require corroboration — never assign `severity: 'critical'` (`>= 45`) to statistical heuristics.
   - Always pair positive AI heuristics with authentic negative evidence (`scoreDelta < 0`, `severity: 'authentic'`) when genuine hardware/acoustic/sensor signals are observed.
5. **Add a synthetic fixture in `src/selftest.ts`:**
   - Construct minimal valid binary bytes in memory (no external binary files committed to git).
   - Add both an AI-positive case and (if relevant) an authentic counter-example so false positives are caught automatically.
6. **Verify end-to-end parity:**
   - Run `npm test && npm run build && npm run test:native` and confirm all self-tests pass with identical verdicts and scores on both Node.js and the native binary.
