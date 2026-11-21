# Scoring Calibration & Defensive Parser Limits

## Scoring Formula (`src/scoring.ts`)

- **Baseline:** `15`
- **Critical AI Provenance:** Any finding with `severity === 'critical'` and `scoreDelta >= 45` forces `aiScore >= 85`, `confidence >= 92`, and `verdict = 'CONFIRMED_AI'`.
- **Single-Heuristic Corroboration Cap:** If there is no critical AI finding and `positiveEvidenceCount <= 1`, `aiScore` is capped at `58` (below the default `LIKELY_AI` threshold of `60`).
- **Verdict Thresholds:**
  - `CONFIRMED_AI`: critical provenance finding OR `aiScore >= 82`
  - `LIKELY_AI`: `aiScore >= threshold` (default `60`)
  - `LIKELY_AUTHENTIC`: `aiScore <= 32`
  - `INCONCLUSIVE`: `33 <= aiScore < threshold`

## Recommended `scoreDelta` Ranges

| Evidence Strength | Severity | `scoreDelta` | Examples |
| --- | --- | --- | --- |
| Explicit C2PA/IPTC AI provenance or generator params | `critical` | `+50` to `+65` | `trainedAlgorithmicMedia`, A1111 `Steps/Sampler/CFG`, ComfyUI `KSampler`, ElevenLabs/Sora/Suno tag |
| Strong signal/temporal artifact | `high` | `+18` to `+26` | 8–12 kHz vocoder brickwall, sterile digital-zero silence, 2/4/8 px VAE grid peak, `4k+1` latent video frames |
| Moderate structural/statistical indicator | `medium` | `+10` to `+18` | Canonical diffusion resolution, silent short video, low text burstiness, vocoder comb peak |
| Weak contextual cue | `low` | `+7` to `+10` | Missing EXIF, epoch-0 timestamp, Lavf muxer, 24 kHz sample rate |
| Authentic hardware / natural signal evidence | `authentic` | `-10` to `-24` | Camera EXIF + optical tags (`-24`), QuickTime camera tags + UTC (`-22`), natural room tone (`-18`), BEXT (`-12`), natural pixel noise (`-10`) |

## Required Safety Limits

- **Zlib decompression (`src/inflate.ts`):** Cap output at `32 MB` for pixel data, `1 MB` for text chunks (`zTXt`/`iTXt`).
- **Image decoding (`src/analyzers/image.ts`):** Cap at `6,000,000` pixels (`width * height`) and `32 MB` compressed `IDAT`.
- **MP4 box recursion (`src/analyzers/video.ts`):** Max recursion depth `10`; cap `stts` iteration at `4096` entries and `stsz` sampling at `2000` frames; break immediately if `size < headerSize` or `pos + size > end`.
- **Audio DSP (`src/analyzers/audio.ts`):** Decode at most `min(sampleRate * 15, 720000)` mono samples and run at most `80` STFT windows.
- **Binary provenance scan (`src/signatures.ts`):** Inspect at most `512 KB` from head and `512 KB` from tail.
