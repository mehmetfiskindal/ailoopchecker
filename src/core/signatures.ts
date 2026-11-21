import { Buffer } from 'node:buffer'
import type { ForensicFinding, MediaCategory } from '../shared/types.ts'
import {
  addUnique,
  extractSnippetUtf8,
  indexOfAscii,
  indexOfUtf8CI,
  printableSlice
} from '../shared/bytes.ts'

export interface SignatureRule {
  id: string
  pattern: string
  generator: string
  category: 'c2pa' | 'iptc' | 'image-ai' | 'video-ai' | 'audio-ai' | 'ml-tool' | 'camera'
  scoreDelta: number
  strong: boolean
}

const AI_SIGNATURE_RULES: SignatureRule[] = [
  // C2PA & IPTC Generative AI Provenance
  { id: 'iptc_trained_algo', pattern: 'trainedalgorithmicmedia', generator: 'IPTC/C2PA Trained Algorithmic Media', category: 'iptc', scoreDelta: 65, strong: true },
  { id: 'iptc_composite_algo', pattern: 'compositewithtrainedalgorithmicmedia', generator: 'IPTC/C2PA Composite AI Media', category: 'iptc', scoreDelta: 55, strong: true },
  { id: 'iptc_algo_media', pattern: 'digitalsourcetype/algorithmicmedia', generator: 'IPTC Algorithmic Media', category: 'iptc', scoreDelta: 50, strong: true },
  { id: 'c2pa_ai_gen', pattern: 'c2pa.ai_generative_training', generator: 'C2PA Content Credentials', category: 'c2pa', scoreDelta: 50, strong: true },
  { id: 'c2pa_actions_created', pattern: 'c2pa.created', generator: 'C2PA Content Credentials', category: 'c2pa', scoreDelta: 15, strong: false },
  { id: 'google_synthid', pattern: 'synthid', generator: 'Google SynthID', category: 'c2pa', scoreDelta: 60, strong: true },

  // Image AI Generators
  { id: 'gen_openai_dalle', pattern: 'dall-e', generator: 'OpenAI DALL-E', category: 'image-ai', scoreDelta: 60, strong: true },
  { id: 'gen_openai_gptimg', pattern: 'gpt-image-1', generator: 'OpenAI GPT-Image', category: 'image-ai', scoreDelta: 60, strong: true },
  { id: 'gen_openai_chatgpt', pattern: 'chatgpt image', generator: 'OpenAI ChatGPT Image', category: 'image-ai', scoreDelta: 55, strong: true },
  { id: 'gen_midjourney', pattern: 'midjourney', generator: 'Midjourney', category: 'image-ai', scoreDelta: 60, strong: true },
  { id: 'gen_stable_diffusion', pattern: 'stable diffusion', generator: 'Stable Diffusion', category: 'image-ai', scoreDelta: 60, strong: true },
  { id: 'gen_comfyui', pattern: 'comfyui', generator: 'ComfyUI', category: 'image-ai', scoreDelta: 60, strong: true },
  { id: 'gen_ksampler', pattern: 'ksampler', generator: 'ComfyUI (KSampler)', category: 'image-ai', scoreDelta: 55, strong: true },
  { id: 'gen_cliptext', pattern: 'cliptextencode', generator: 'ComfyUI (CLIPTextEncode)', category: 'image-ai', scoreDelta: 55, strong: true },
  { id: 'gen_a1111', pattern: 'automatic1111', generator: 'AUTOMATIC1111 WebUI', category: 'image-ai', scoreDelta: 60, strong: true },
  { id: 'gen_invokeai', pattern: 'invokeai', generator: 'InvokeAI', category: 'image-ai', scoreDelta: 60, strong: true },
  { id: 'gen_novelai', pattern: 'novelai', generator: 'NovelAI Diffusion', category: 'image-ai', scoreDelta: 60, strong: true },
  { id: 'gen_fooocus', pattern: 'fooocus', generator: 'Fooocus', category: 'image-ai', scoreDelta: 55, strong: true },
  { id: 'gen_firefly', pattern: 'adobe firefly', generator: 'Adobe Firefly', category: 'image-ai', scoreDelta: 60, strong: true },
  { id: 'gen_imagen', pattern: 'google imagen', generator: 'Google Imagen', category: 'image-ai', scoreDelta: 60, strong: true },
  { id: 'gen_gemini_ai', pattern: 'made with google ai', generator: 'Google AI (Imagen/Veo)', category: 'image-ai', scoreDelta: 60, strong: true },
  { id: 'gen_bfl_flux', pattern: 'black forest labs', generator: 'Flux (Black Forest Labs)', category: 'image-ai', scoreDelta: 60, strong: true },
  { id: 'gen_ideogram', pattern: 'ideogram', generator: 'Ideogram', category: 'image-ai', scoreDelta: 55, strong: true },
  { id: 'gen_recraft', pattern: 'recraft', generator: 'Recraft AI', category: 'image-ai', scoreDelta: 55, strong: true },
  { id: 'gen_leonardo', pattern: 'leonardo.ai', generator: 'Leonardo.ai', category: 'image-ai', scoreDelta: 55, strong: true },
  { id: 'gen_civitai', pattern: 'civitai', generator: 'Civitai / Diffusion', category: 'image-ai', scoreDelta: 50, strong: true },
  { id: 'gen_sdxl', pattern: 'sdxl', generator: 'Stable Diffusion XL', category: 'image-ai', scoreDelta: 45, strong: true },
  { id: 'gen_seedream', pattern: 'seedream', generator: 'ByteDance Seedream', category: 'image-ai', scoreDelta: 55, strong: true },

  // Video AI Generators
  { id: 'gen_sora', pattern: 'openai sora', generator: 'OpenAI Sora', category: 'video-ai', scoreDelta: 65, strong: true },
  { id: 'gen_runway', pattern: 'runwayml', generator: 'Runway Gen', category: 'video-ai', scoreDelta: 60, strong: true },
  { id: 'gen_runway2', pattern: 'runway gen-', generator: 'Runway Gen', category: 'video-ai', scoreDelta: 60, strong: true },
  { id: 'gen_kling', pattern: 'kling ai', generator: 'Kling AI', category: 'video-ai', scoreDelta: 60, strong: true },
  { id: 'gen_kling2', pattern: 'klingai', generator: 'Kling AI', category: 'video-ai', scoreDelta: 60, strong: true },
  { id: 'gen_veo', pattern: 'google veo', generator: 'Google Veo', category: 'video-ai', scoreDelta: 60, strong: true },
  { id: 'gen_luma', pattern: 'luma dream machine', generator: 'Luma Dream Machine', category: 'video-ai', scoreDelta: 60, strong: true },
  { id: 'gen_pika', pattern: 'pika.art', generator: 'Pika Labs', category: 'video-ai', scoreDelta: 60, strong: true },
  { id: 'gen_heygen', pattern: 'heygen', generator: 'HeyGen', category: 'video-ai', scoreDelta: 60, strong: true },
  { id: 'gen_synthesia', pattern: 'synthesia', generator: 'Synthesia', category: 'video-ai', scoreDelta: 60, strong: true },
  { id: 'gen_hailuo', pattern: 'hailuo', generator: 'MiniMax Hailuo', category: 'video-ai', scoreDelta: 55, strong: true },
  { id: 'gen_minimax', pattern: 'minimax video', generator: 'MiniMax Video', category: 'video-ai', scoreDelta: 55, strong: true },
  { id: 'gen_seedance', pattern: 'seedance', generator: 'ByteDance Seedance', category: 'video-ai', scoreDelta: 55, strong: true },
  { id: 'gen_hunyuan', pattern: 'hunyuanvideo', generator: 'HunyuanVideo', category: 'video-ai', scoreDelta: 55, strong: true },
  { id: 'gen_cogvideo', pattern: 'cogvideo', generator: 'CogVideoX', category: 'video-ai', scoreDelta: 55, strong: true },
  { id: 'gen_ltxvideo', pattern: 'ltx-video', generator: 'LTX-Video', category: 'video-ai', scoreDelta: 55, strong: true },
  { id: 'gen_wan_video', pattern: 'wan2.1', generator: 'Alibaba Wan Video', category: 'video-ai', scoreDelta: 55, strong: true },
  { id: 'gen_vidu', pattern: 'vidu.studio', generator: 'Vidu AI', category: 'video-ai', scoreDelta: 55, strong: true },
  { id: 'gen_hedra', pattern: 'hedra', generator: 'Hedra', category: 'video-ai', scoreDelta: 50, strong: true },
  { id: 'gen_sadtalker', pattern: 'sadtalker', generator: 'SadTalker', category: 'video-ai', scoreDelta: 55, strong: true },
  { id: 'gen_liveportrait', pattern: 'liveportrait', generator: 'LivePortrait', category: 'video-ai', scoreDelta: 55, strong: true },
  { id: 'gen_topaz', pattern: 'topaz video ai', generator: 'Topaz Video AI', category: 'video-ai', scoreDelta: 30, strong: false },

  // Audio / Voice / Music AI Generators
  { id: 'gen_elevenlabs', pattern: 'elevenlabs', generator: 'ElevenLabs', category: 'audio-ai', scoreDelta: 65, strong: true },
  { id: 'gen_suno', pattern: 'suno ai', generator: 'Suno AI', category: 'audio-ai', scoreDelta: 65, strong: true },
  { id: 'gen_suno2', pattern: 'suno.com', generator: 'Suno AI', category: 'audio-ai', scoreDelta: 65, strong: true },
  { id: 'gen_udio', pattern: 'udio.com', generator: 'Udio', category: 'audio-ai', scoreDelta: 65, strong: true },
  { id: 'gen_coqui', pattern: 'coqui-tts', generator: 'Coqui XTTS', category: 'audio-ai', scoreDelta: 60, strong: true },
  { id: 'gen_xtts', pattern: 'xtts_v2', generator: 'Coqui XTTS v2', category: 'audio-ai', scoreDelta: 60, strong: true },
  { id: 'gen_fishaudio', pattern: 'fish audio', generator: 'Fish Audio', category: 'audio-ai', scoreDelta: 60, strong: true },
  { id: 'gen_cartesia', pattern: 'cartesia', generator: 'Cartesia Sonic', category: 'audio-ai', scoreDelta: 60, strong: true },
  { id: 'gen_playht', pattern: 'play.ht', generator: 'PlayHT', category: 'audio-ai', scoreDelta: 60, strong: true },
  { id: 'gen_murf', pattern: 'murf.ai', generator: 'Murf.ai', category: 'audio-ai', scoreDelta: 60, strong: true },
  { id: 'gen_musicgen', pattern: 'musicgen', generator: 'Meta MusicGen', category: 'audio-ai', scoreDelta: 60, strong: true },
  { id: 'gen_audiocraft', pattern: 'audiocraft', generator: 'Meta AudioCraft', category: 'audio-ai', scoreDelta: 60, strong: true },
  { id: 'gen_stableaudio', pattern: 'stable audio', generator: 'Stability Stable Audio', category: 'audio-ai', scoreDelta: 60, strong: true },
  { id: 'gen_lyria', pattern: 'google lyria', generator: 'Google Lyria', category: 'audio-ai', scoreDelta: 60, strong: true },
  { id: 'gen_bark', pattern: 'suno-bark', generator: 'Suno Bark', category: 'audio-ai', scoreDelta: 60, strong: true },
  { id: 'gen_kokoro', pattern: 'kokoro-tts', generator: 'Kokoro TTS', category: 'audio-ai', scoreDelta: 60, strong: true },
  { id: 'gen_piper', pattern: 'piper-tts', generator: 'Piper TTS', category: 'audio-ai', scoreDelta: 60, strong: true },
  { id: 'gen_resemble', pattern: 'resemble.ai', generator: 'Resemble AI', category: 'audio-ai', scoreDelta: 60, strong: true },
  { id: 'gen_rvc', pattern: 'rvc-voice', generator: 'RVC Voice Conversion', category: 'audio-ai', scoreDelta: 55, strong: true },
  { id: 'gen_riffusion', pattern: 'riffusion', generator: 'Riffusion', category: 'audio-ai', scoreDelta: 55, strong: true },

  // Programmatic / ML pipeline indicators
  { id: 'ml_diffusers', pattern: 'diffusers', generator: 'HuggingFace Diffusers', category: 'ml-tool', scoreDelta: 35, strong: false },
  { id: 'ml_torchaudio', pattern: 'torchaudio', generator: 'PyTorch Audio', category: 'ml-tool', scoreDelta: 25, strong: false },
  { id: 'ml_openai', pattern: 'openai', generator: 'OpenAI', category: 'ml-tool', scoreDelta: 35, strong: false }
]

export interface SignatureScanResult {
  findings: ForensicFinding[]
  generators: string[]
  hasC2paBox: boolean
  hasAiProvenance: boolean
}

// Fast O(N) byte-level signature scanner: avoids O(N^2) string.toLowerCase() / indexOf on large C++ UTF-8 buffers.
export function scanBytesForAiSignatures(
  byteSources: Uint8Array[],
  mediaCategory: MediaCategory
): SignatureScanResult {
  const findings: ForensicFinding[] = []
  const generators: string[] = []
  const matchedIds = new Set<string>()
  let hasAiProvenance = false

  for (let s = 0; s < byteSources.length; s++) {
    const raw = byteSources[s]!
    if (raw.length === 0) continue
    const scanLen = Math.min(raw.length, 32768)

    if (
      !matchedIds.has('a1111_params') &&
      indexOfUtf8CI(raw, 'steps:', 0, scanLen) >= 0 &&
      (indexOfUtf8CI(raw, 'sampler:', 0, scanLen) >= 0 || indexOfUtf8CI(raw, 'cfg scale:', 0, scanLen) >= 0)
    ) {
      matchedIds.add('a1111_params')
      hasAiProvenance = true
      addUnique(generators, 'Stable Diffusion (A1111/Forge)')
      findings.push({
        id: 'sig_a1111_params',
        category: 'metadata',
        severity: 'critical',
        scoreDelta: 65,
        titleTr: 'Difüzyon üretim parametreleri bulundu',
        titleEn: 'Diffusion generation parameters detected',
        detailTr: 'Dosya metaverisinde Steps / Sampler / CFG scale gibi Stable Diffusion üretim parametreleri yer alıyor.',
        detailEn: 'File metadata contains Stable Diffusion generation parameters (Steps / Sampler / CFG scale).',
        evidence: extractSnippetUtf8(raw, 0, Math.min(160, scanLen))
      })
    }

    for (let r = 0; r < AI_SIGNATURE_RULES.length; r++) {
      const rule = AI_SIGNATURE_RULES[r]!
      if (matchedIds.has(rule.id)) continue
      const idx = indexOfUtf8CI(raw, rule.pattern, 0, scanLen)
      if (idx < 0) continue

      matchedIds.add(rule.id)
      addUnique(generators, rule.generator)
      if (rule.strong) hasAiProvenance = true

      const snippet = extractSnippetUtf8(raw, idx, rule.pattern.length)
      const isC2paOrIptc = rule.category === 'c2pa' || rule.category === 'iptc'
      findings.push({
        id: `sig_${rule.id}`,
        category: isC2paOrIptc ? 'provenance' : 'metadata',
        severity: rule.strong ? 'critical' : 'medium',
        scoreDelta: rule.scoreDelta,
        titleTr: isC2paOrIptc
          ? `C2PA / IPTC AI köken beyanı: ${rule.generator}`
          : `AI üretici imzası tespit edildi: ${rule.generator}`,
        titleEn: isC2paOrIptc
          ? `C2PA / IPTC AI provenance claim: ${rule.generator}`
          : `AI generator signature detected: ${rule.generator}`,
        detailTr: isC2paOrIptc
          ? `Dosya içinde kriptografik veya standartlaştırılmış AI üretim beyanı ('${rule.pattern}') bulundu.`
          : `${mediaCategory} dosya metaverisinde bilinen AI üretici/araç imzası ('${rule.pattern}') tespit edildi.`,
        detailEn: isC2paOrIptc
          ? `Standardized AI provenance declaration ('${rule.pattern}') was found inside the file.`
          : `Known AI generator/tool signature ('${rule.pattern}') was found in ${mediaCategory} metadata.`,
        evidence: snippet
      })
    }
  }

  return {
    findings,
    generators,
    hasC2paBox: false,
    hasAiProvenance
  }
}

export function scanTextForAiSignatures(
  textSources: string[],
  mediaCategory: MediaCategory
): SignatureScanResult {
  const buffers: Uint8Array[] = []
  for (let i = 0; i < textSources.length; i++) {
    const t = textSources[i]!
    if (t.length > 0) buffers.push(Buffer.from(t, 'utf8'))
  }
  return scanBytesForAiSignatures(buffers, mediaCategory)
}

export function scanBinaryForC2paAndXmp(buf: Uint8Array, mediaCategory: MediaCategory): SignatureScanResult {
  const findings: ForensicFinding[] = []
  const generators: string[] = []
  let hasC2paBox = false
  let hasAiProvenance = false

  const windows: Uint8Array[] = []
  const headLen = Math.min(buf.length, 524288)
  windows.push(buf.subarray(0, headLen))
  if (buf.length > 524288) {
    const tailStart = Math.max(headLen, buf.length - 524288)
    windows.push(buf.subarray(tailStart))
  }

  const extractedSlices: Uint8Array[] = []
  for (let w = 0; w < windows.length; w++) {
    const win = windows[w]!
    const jumbIdx = indexOfAscii(win, 'jumb')
    const c2paIdx = indexOfAscii(win, 'c2pa')
    if (jumbIdx >= 0 && c2paIdx >= 0) {
      hasC2paBox = true
      const sliceStart = Math.max(0, Math.min(jumbIdx, c2paIdx) - 32)
      const sliceEnd = Math.min(win.length, sliceStart + 16384)
      extractedSlices.push(win.subarray(sliceStart, sliceEnd))
    }

    const xmpIdx = indexOfAscii(win, '<x:xmpmeta')
    if (xmpIdx >= 0) {
      const endIdx = indexOfAscii(win, '</x:xmpmeta>', xmpIdx)
      const sliceEnd = endIdx > xmpIdx ? Math.min(win.length, endIdx + 12) : Math.min(win.length, xmpIdx + 16384)
      extractedSlices.push(win.subarray(xmpIdx, sliceEnd))
    }

    const dstIdx = indexOfAscii(win, 'DigitalSourceType')
    if (dstIdx >= 0) {
      extractedSlices.push(win.subarray(Math.max(0, dstIdx - 64), Math.min(win.length, dstIdx + 512)))
    }
  }

  if (hasC2paBox) {
    findings.push({
      id: 'c2pa_container_present',
      category: 'provenance',
      severity: 'low',
      scoreDelta: 8,
      titleTr: 'C2PA / JUMBF İçerik Kimlik Bilgisi (Content Credentials) konteyneri mevcut',
      titleEn: 'C2PA / JUMBF Content Credentials container present',
      detailTr: 'Dosyada C2PA/JUMBF provenance bloğu bulunuyor; içerik kimliği iddiaları tarandı.',
      detailEn: 'File embeds a C2PA/JUMBF provenance block; embedded assertions were inspected.',
      evidence: 'jumb + c2pa box'
    })
  }

  if (extractedSlices.length > 0) {
    const textScan = scanBytesForAiSignatures(extractedSlices, mediaCategory)
    for (let i = 0; i < textScan.findings.length; i++) {
      findings.push(textScan.findings[i]!)
    }
    for (let i = 0; i < textScan.generators.length; i++) {
      addUnique(generators, textScan.generators[i]!)
    }
    if (textScan.hasAiProvenance) hasAiProvenance = true
  }

  void printableSlice
  return {
    findings,
    generators,
    hasC2paBox,
    hasAiProvenance
  }
}
