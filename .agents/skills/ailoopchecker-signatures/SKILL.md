---
name: ailoopchecker-signatures
description: >-
  Add, update, or audit AI generator signatures, C2PA/JUMBF provenance rules,
  IPTC DigitalSourceType patterns, and authentic camera/recorder markers in
  ailoopchecker. Use when adding support for a new AI model/service (image,
  video, audio) or fixing a signature false positive or false negative.
---

# Managing AI Provenance & Generator Signatures

Use this runbook when modifying `src/core/signatures.ts` (or authentic device lists in `src/features/image/analyzer.ts`, `src/features/video/analyzer.ts`, `src/features/audio/analyzer.ts`).

## Signature Rule Design Rules

All rules live in `AI_SIGNATURE_RULES` in `src/core/signatures.ts`:

```ts
{
  id: 'gen_example',
  pattern: 'example-ai-model', // ALWAYS lowercase
  generator: 'Example AI',
  category: 'image-ai',        // 'c2pa' | 'iptc' | 'image-ai' | 'video-ai' | 'audio-ai' | 'ml-tool' | 'camera'
  scoreDelta: 60,              // >= 45 with strong: true triggers CONFIRMED_AI
  strong: true
}
```

### Avoiding False Positives
1. **Never use short or generic substrings** (e.g., avoid `'flux'`, `'sora'`, `'wan'`, `'pika'`, `'bark'`, `'veo'`, `'luma'`, `'ai'`). Use specific compound identifiers instead: `'black forest labs'`, `'openai sora'`, `'wan2.1'`, `'pika.art'`, `'suno-bark'`, `'google veo'`, `'luma dream machine'`.
2. **Use `strong: false` and `scoreDelta: 15–35`** for tools that can appear in non-AI workflows (e.g., `torchaudio`, `diffusers`, `topaz video ai`, `c2pa.created` without an AI `digitalSourceType`).
3. **Keep `pattern` strictly lowercase:** Matching runs against `raw.toLowerCase()`.
4. **Keep `id` globally unique** across `AI_SIGNATURE_RULES` (deduplication keys off `rule.id`).

## Steps to Add or Fix a Signature

1. Inspect the target sample's extracted text/metadata first using:
   ```bash
   ./dist/ailoopchecker -v --json <sample-file>
   ```
2. Add or refine the entry in `src/signatures.ts`.
3. If the signature sits in a new container chunk/box (e.g., a new PNG chunk, MP4 atom, or WAV RIFF subchunk), ensure the corresponding analyzer pushes that decoded text into `textSources`.
4. Add or update a synthetic test case in `src/selftest.ts` verifying:
   - the new signature triggers the expected `generatorHints` and `verdict`, and
   - authentic fixtures remain `LIKELY_AUTHENTIC`.
5. Update `CHANGELOG.md` under `[Unreleased]` (or current version) if preparing a release.
6. Validate both runtimes:
   ```bash
   npm test && npm run build && npm run test:native
   ```
