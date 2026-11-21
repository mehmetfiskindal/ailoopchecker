---
name: ailoopchecker-cli-audit
description: >-
  Run ailoopchecker to forensically inspect images, visual products, videos,
  audio recordings, or product copy text, interpret verdicts and metrics, or
  integrate strict JSON checks into CI/CD pipelines. Use when auditing media
  files or troubleshooting CLI flags and exit codes.
---

# Running ailoopchecker Forensic Audits

Use this runbook when scanning media files or setting up automated AI-content checks with `ailoopchecker`.

## Ensure Binary Exists

If `./dist/ailoopchecker` is missing or outdated relative to `src/`:

```bash
npm run build
```

## Common Audit Commands

```bash
# Single or multi-file scan (auto-detects image/video/audio/text via magic bytes)
./dist/ailoopchecker path/to/product.png path/to/clip.mp4 path/to/voice.wav

# Detailed forensic report (SHA-256, extracted metadata, pixel/DSP/video metrics)
./dist/ailoopchecker -v --no-color path/to/file

# English output
./dist/ailoopchecker --lang en -v path/to/file

# Machine-readable JSON + CI strict gate (exit code 2 on LIKELY_AI or CONFIRMED_AI)
./dist/ailoopchecker --json --strict --threshold 60 path/to/file1 path/to/file2

# Built-in 7-case forensic sanity check
./dist/ailoopchecker --self-test
```

## Interpreting Results & Exit Codes

- **Exit `0`:** Completed cleanly (and no AI detected when `--strict` is set).
- **Exit `1`:** Missing file, directory passed instead of file, invalid flag, or runtime error.
- **Exit `2`:** `--strict` enabled and at least one file scored `LIKELY_AI` or `CONFIRMED_AI`.

For metric definitions (`pixel_grid_autocorr_peak`, `video_frame_count`, `audio_8khz_cutoff_drop_db`, `audio_sterile_silence_ratio`, `text_burstiness_cv`) and known limitations (social-media metadata stripping, compressed MP3/OGG DSP scope, studio noise gates), see `docs/DETECTION_GUIDE.md`.

## Privacy Reminder

`ailoopchecker` is 100% offline and read-only, but `-v` and `--json` print extracted EXIF/XMP/ID3/prompt strings to stdout. Redact sensitive metadata before sharing reports externally.
