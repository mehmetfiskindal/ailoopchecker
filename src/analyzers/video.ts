import type { AnalyzerResult, ForensicFinding, KeyValueEntry } from '../types.ts'
import {
  asciiAt,
  extractAsciiRuns,
  printableSlice,
  readU16BE,
  readU32BE,
  readU32LE,
  readU64BE,
  round2,
  shannonEntropy
} from '../bytes.ts'
import {
  addUnique,
  scanBinaryForC2paAndXmp,
  scanTextForAiSignatures
} from '../signatures.ts'

interface Mp4TrackSummary {
  handler: string
  codec: string
  width: number
  height: number
  timescale: number
  duration: number
  sampleCount: number
  sttsEntryCount: number
  firstSampleDelta: number
  keyframeCount: number
  avgFrameBytes: number
  frameSizeCv: number
}

interface Mp4Context {
  majorBrand: string
  creationTime: number
  modificationTime: number
  movieTimescale: number
  movieDuration: number
  tracks: Mp4TrackSummary[]
  currentTrack: Mp4TrackSummary | null
  encoderTags: string[]
  cameraTags: string[]
  textSources: string[]
  hasC2paUuid: boolean
  hasXmpUuid: boolean
}

const CONTAINER_BOXES = new Set<string>([
  'moov',
  'trak',
  'mdia',
  'minf',
  'stbl',
  'udta',
  'ilst',
  'edts',
  'dinf'
])

const LATENT_VIDEO_FRAME_COUNTS = new Set<number>([
  16, 24, 25, 33, 41, 49, 57, 65, 73, 81, 89, 97, 105, 113, 121, 129, 145, 161, 193, 241, 257
])

const AI_VIDEO_RESOLUTIONS = new Set<string>([
  '512x512',
  '576x1024',
  '1024x576',
  '768x768',
  '768x1280',
  '1280x768',
  '768x1344',
  '1344x768',
  '480x832',
  '832x480',
  '480x848',
  '848x480',
  '512x896',
  '896x512',
  '720x1280',
  '1280x720',
  '1088x1920',
  '1920x1088',
  '896x1152',
  '1152x896'
])

function bytesMatchHex(buf: Uint8Array, offset: number, hex: string): boolean {
  const len = hex.length / 2
  if (offset + len > buf.length) return false
  for (let i = 0; i < len; i++) {
    const byteVal = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
    if (buf[offset + i] !== byteVal) return false
  }
  return true
}

function walkMp4Boxes(buf: Uint8Array, start: number, end: number, depth: number, ctx: Mp4Context): void {
  if (depth > 10) return
  let pos = start
  while (pos + 8 <= end) {
    let size = readU32BE(buf, pos)
    const type = asciiAt(buf, pos + 4, 4)
    let headerSize = 8

    if (size === 1) {
      if (pos + 16 > end) break
      size = readU64BE(buf, pos + 8)
      headerSize = 16
    } else if (size === 0) {
      size = end - pos
    }

    if (size < headerSize || pos + size > end) break
    const dataStart = pos + headerSize
    const dataEnd = pos + size

    if (type === 'ftyp' && dataEnd - dataStart >= 4) {
      ctx.majorBrand = asciiAt(buf, dataStart, 4).trim()
    } else if (type === 'mvhd' && dataEnd - dataStart >= 20) {
      const version = buf[dataStart]!
      if (version === 0 && dataEnd - dataStart >= 20) {
        ctx.creationTime = readU32BE(buf, dataStart + 4)
        ctx.modificationTime = readU32BE(buf, dataStart + 8)
        ctx.movieTimescale = readU32BE(buf, dataStart + 12)
        ctx.movieDuration = readU32BE(buf, dataStart + 16)
      } else if (version === 1 && dataEnd - dataStart >= 32) {
        ctx.creationTime = readU64BE(buf, dataStart + 4)
        ctx.modificationTime = readU64BE(buf, dataStart + 12)
        ctx.movieTimescale = readU32BE(buf, dataStart + 20)
        ctx.movieDuration = readU64BE(buf, dataStart + 24)
      }
    } else if (type === 'trak') {
      const track: Mp4TrackSummary = {
        handler: '',
        codec: '',
        width: 0,
        height: 0,
        timescale: 0,
        duration: 0,
        sampleCount: 0,
        sttsEntryCount: 0,
        firstSampleDelta: 0,
        keyframeCount: 0,
        avgFrameBytes: 0,
        frameSizeCv: 0
      }
      ctx.tracks.push(track)
      const prev = ctx.currentTrack
      ctx.currentTrack = track
      walkMp4Boxes(buf, dataStart, dataEnd, depth + 1, ctx)
      ctx.currentTrack = prev
      pos = dataEnd
      continue
    } else if (type === 'tkhd' && ctx.currentTrack !== null) {
      const version = buf[dataStart]!
      const whOffset = version === 1 ? dataStart + 88 : dataStart + 76
      if (whOffset + 8 <= dataEnd) {
        const wFixed = readU32BE(buf, whOffset)
        const hFixed = readU32BE(buf, whOffset + 4)
        const w = wFixed >>> 16
        const h = hFixed >>> 16
        if (w > 0 && h > 0) {
          ctx.currentTrack.width = w
          ctx.currentTrack.height = h
        }
      }
    } else if (type === 'mdhd' && ctx.currentTrack !== null) {
      const version = buf[dataStart]!
      if (version === 0 && dataEnd - dataStart >= 20) {
        ctx.currentTrack.timescale = readU32BE(buf, dataStart + 12)
        ctx.currentTrack.duration = readU32BE(buf, dataStart + 16)
      } else if (version === 1 && dataEnd - dataStart >= 32) {
        ctx.currentTrack.timescale = readU32BE(buf, dataStart + 20)
        ctx.currentTrack.duration = readU64BE(buf, dataStart + 24)
      }
    } else if (type === 'hdlr' && ctx.currentTrack !== null && dataEnd - dataStart >= 12) {
      ctx.currentTrack.handler = asciiAt(buf, dataStart + 8, 4)
      if (dataEnd - dataStart > 24) {
        const name = printableSlice(buf, dataStart + 24, dataEnd, 256).trim()
        if (name.length > 0) ctx.textSources.push(name)
      }
    } else if (type === 'stsd' && ctx.currentTrack !== null && dataEnd - dataStart >= 16) {
      const codec = asciiAt(buf, dataStart + 12, 4)
      ctx.currentTrack.codec = codec
      if (
        (codec === 'avc1' || codec === 'hvc1' || codec === 'hev1' || codec === 'vp09' || codec === 'av01' || codec === 'mp4v') &&
        dataStart + 44 <= dataEnd
      ) {
        const w = readU16BE(buf, dataStart + 32)
        const h = readU16BE(buf, dataStart + 34)
        if (w > 0 && h > 0) {
          ctx.currentTrack.width = w
          ctx.currentTrack.height = h
        }
      }
    } else if (type === 'stts' && ctx.currentTrack !== null && dataEnd - dataStart >= 8) {
      const entryCount = readU32BE(buf, dataStart + 4)
      ctx.currentTrack.sttsEntryCount = entryCount
      let totalSamples = 0
      let p = dataStart + 8
      const maxEntries = Math.min(entryCount, 4096)
      for (let i = 0; i < maxEntries && p + 8 <= dataEnd; i++) {
        const count = readU32BE(buf, p)
        const delta = readU32BE(buf, p + 4)
        if (i === 0) ctx.currentTrack.firstSampleDelta = delta
        totalSamples += count
        p += 8
      }
      if (totalSamples > 0) ctx.currentTrack.sampleCount = totalSamples
    } else if (type === 'stsz' && ctx.currentTrack !== null && dataEnd - dataStart >= 12) {
      const uniformSize = readU32BE(buf, dataStart + 4)
      const count = readU32BE(buf, dataStart + 8)
      if (count > 0 && ctx.currentTrack.sampleCount === 0) {
        ctx.currentTrack.sampleCount = count
      }
      if (uniformSize > 0) {
        ctx.currentTrack.avgFrameBytes = uniformSize
        ctx.currentTrack.frameSizeCv = 0
      } else if (count > 1) {
        const maxRead = Math.min(count, 2000)
        let sum = 0
        let sumSq = 0
        let valid = 0
        let p = dataStart + 12
        for (let i = 0; i < maxRead && p + 4 <= dataEnd; i++) {
          const sz = readU32BE(buf, p)
          sum += sz
          sumSq += sz * sz
          valid++
          p += 4
        }
        if (valid > 1) {
          const mean = sum / valid
          const variance = Math.max(0, sumSq / valid - mean * mean)
          ctx.currentTrack.avgFrameBytes = mean
          ctx.currentTrack.frameSizeCv = mean > 0 ? Math.sqrt(variance) / mean : 0
        }
      }
    } else if (type === 'stss' && ctx.currentTrack !== null && dataEnd - dataStart >= 8) {
      ctx.currentTrack.keyframeCount = readU32BE(buf, dataStart + 4)
    } else if (type === 'uuid' && dataEnd - dataStart >= 16) {
      if (bytesMatchHex(buf, dataStart, 'd8fec3d61b0e483c92975828877ec481')) {
        ctx.hasC2paUuid = true
      } else if (bytesMatchHex(buf, dataStart, 'be7acfcb97a942e89c71999491e3afac')) {
        ctx.hasXmpUuid = true
      }
      ctx.textSources.push(printableSlice(buf, dataStart + 16, dataEnd, 16384))
    } else if (type === 'meta') {
      // FullBox (4 bytes version/flags) or plain container
      const offsetAfterFlags = dataStart + 4 <= dataEnd && buf[dataStart] === 0 && buf[dataStart + 1] === 0 ? dataStart + 4 : dataStart
      walkMp4Boxes(buf, offsetAfterFlags, dataEnd, depth + 1, ctx)
      ctx.textSources.push(printableSlice(buf, dataStart, dataEnd, 8192))
      pos = dataEnd
      continue
    } else if (
      type === '\xa9too' ||
      type === '\xa9swr' ||
      type === '\xa9cmt' ||
      type === '\xa9des' ||
      type === '\xa9nam' ||
      type === '\xa9ART'
    ) {
      const val = printableSlice(buf, dataStart, dataEnd, 1024).replace(/^data/, '').trim()
      if (val.length > 0) {
        ctx.encoderTags.push(`${type.replace('\xa9', '@')}=${val}`)
        ctx.textSources.push(val)
      }
    } else if (type === '\xa9mak' || type === '\xa9mod' || type === '\xa9xyz') {
      const val = printableSlice(buf, dataStart, dataEnd, 512).replace(/^data/, '').trim()
      if (val.length > 0) {
        ctx.cameraTags.push(`${type.replace('\xa9', '@')}=${val}`)
        ctx.textSources.push(val)
      }
    } else if (CONTAINER_BOXES.has(type)) {
      walkMp4Boxes(buf, dataStart, dataEnd, depth + 1, ctx)
    } else if (type === 'keys' || type === 'data' || type === 'name' || type === 'free') {
      if (dataEnd - dataStart <= 16384) {
        const s = printableSlice(buf, dataStart, dataEnd, 4096).trim()
        if (s.length >= 4) ctx.textSources.push(s)
      }
    }

    pos = dataEnd
  }
}

function analyzeMp4Family(
  buf: Uint8Array,
  findings: ForensicFinding[],
  metadata: KeyValueEntry[],
  metrics: KeyValueEntry[],
  textSources: string[]
): void {
  const ctx: Mp4Context = {
    majorBrand: '',
    creationTime: 0,
    modificationTime: 0,
    movieTimescale: 0,
    movieDuration: 0,
    tracks: [],
    currentTrack: null,
    encoderTags: [],
    cameraTags: [],
    textSources,
    hasC2paUuid: false,
    hasXmpUuid: false
  }

  walkMp4Boxes(buf, 0, buf.length, 0, ctx)

  if (ctx.majorBrand.length > 0) metadata.push({ key: 'mp4_major_brand', value: ctx.majorBrand })
  if (ctx.encoderTags.length > 0) metadata.push({ key: 'mp4_encoder_tags', value: ctx.encoderTags.join('; ').slice(0, 200) })
  if (ctx.cameraTags.length > 0) metadata.push({ key: 'mp4_camera_tags', value: ctx.cameraTags.join('; ').slice(0, 200) })

  if (ctx.hasC2paUuid) {
    findings.push({
      id: 'vid_mp4_c2pa_uuid',
      category: 'provenance',
      severity: 'low',
      scoreDelta: 10,
      titleTr: 'MP4 C2PA UUID kutusu bulundu',
      titleEn: 'MP4 C2PA UUID box detected',
      detailTr: 'Video konteynerinde C2PA İçerik Kimlik Bilgisi UUID kutusu mevcut.',
      detailEn: 'Video container embeds a C2PA Content Credentials UUID box.',
      evidence: 'uuid d8fec3d6-1b0e-483c-9297-5828877ec481'
    })
  }

  let videoTrack: Mp4TrackSummary | null = null
  let hasAudioTrack = false
  for (let i = 0; i < ctx.tracks.length; i++) {
    const tr = ctx.tracks[i]!
    if (tr.handler === 'vide' && videoTrack === null) videoTrack = tr
    if (tr.handler === 'soun') hasAudioTrack = true
  }

  const durationSec =
    ctx.movieTimescale > 0
      ? ctx.movieDuration / ctx.movieTimescale
      : videoTrack !== null && videoTrack.timescale > 0
        ? videoTrack.duration / videoTrack.timescale
        : 0

  metrics.push({ key: 'track_count', value: String(ctx.tracks.length) })
  metrics.push({ key: 'has_audio_track', value: hasAudioTrack ? 'yes' : 'no' })
  if (durationSec > 0) metrics.push({ key: 'duration_sec', value: String(round2(durationSec)) })

  // Check 1904 epoch creation time anomaly (programmatic FFmpeg/PyAV/OpenCV muxer)
  if (ctx.creationTime === 0 && ctx.tracks.length > 0) {
    findings.push({
      id: 'vid_epoch_zero_timestamp',
      category: 'container',
      severity: 'low',
      scoreDelta: 9,
      titleTr: 'Video oluşturma zaman damgası sıfır (1904-01-01)',
      titleEn: 'Zero creation timestamp (1904 epoch)',
      detailTr: 'mvhd creation_time=0; gerçek telefon/kamera kayıtları UTC zaman damgası yazar, programatik AI/FFmpeg çıktıları sıfır bırakır.',
      detailEn: 'mvhd creation_time=0; real cameras stamp UTC capture times whereas programmatic AI/FFmpeg muxers typically leave it zero.',
      evidence: 'mvhd.creation_time=0'
    })
  }

  // Authentic camera / smartphone provenance inside QuickTime/MP4
  if (ctx.cameraTags.length > 0 && ctx.creationTime > 3000000000) {
    findings.push({
      id: 'vid_camera_device_tags',
      category: 'provenance',
      severity: 'authentic',
      scoreDelta: -22,
      titleTr: 'Gerçek kamera/cihaz QuickTime etiketleri bulundu',
      titleEn: 'Authentic camera/device QuickTime tags present',
      detailTr: `Konteynerde cihaz üreticisi/modeli/konum etiketi ve geçerli kayıt zaman damgası bulunuyor.`,
      detailEn: 'Container carries device make/model/location metadata and a valid capture timestamp.',
      evidence: ctx.cameraTags.join('; ').slice(0, 140)
    })
  }

  // Check programmatic Lavf encoder combined with missing camera tags
  const allEncLower = ctx.encoderTags.join(' ').toLowerCase()
  const hasLavf = allEncLower.indexOf('lavf') >= 0
  if (hasLavf && ctx.cameraTags.length === 0) {
    findings.push({
      id: 'vid_lavf_programmatic_mux',
      category: 'container',
      severity: 'low',
      scoreDelta: 8,
      titleTr: 'Programatik FFmpeg/Lavf muxer imzası',
      titleEn: 'Programmatic FFmpeg/Lavf muxer signature',
      detailTr: 'Video kamera yerine Lavf/FFmpeg boru hattıyla paketlenmiş (AI video servislerinin çoğu çıktıyı Lavf ile paketler).',
      detailEn: 'Video was muxed with Lavf/FFmpeg without camera tags (common across AI video generation APIs).',
      evidence: ctx.encoderTags.join('; ').slice(0, 120)
    })
  }

  if (videoTrack !== null) {
    const dim = `${videoTrack.width}x${videoTrack.height}`
    metadata.push({ key: 'video_codec', value: videoTrack.codec || 'unknown' })
    metadata.push({ key: 'video_dimensions', value: dim })
    metrics.push({ key: 'video_frame_count', value: String(videoTrack.sampleCount) })

    const fps =
      videoTrack.timescale > 0 && videoTrack.firstSampleDelta > 0
        ? videoTrack.timescale / videoTrack.firstSampleDelta
        : durationSec > 0 && videoTrack.sampleCount > 0
          ? videoTrack.sampleCount / durationSec
          : 0
    if (fps > 0) metrics.push({ key: 'video_fps', value: String(round2(fps)) })
    if (videoTrack.avgFrameBytes > 0) {
      metrics.push({ key: 'video_avg_frame_bytes', value: String(Math.round(videoTrack.avgFrameBytes)) })
      metrics.push({ key: 'video_frame_size_cv', value: String(round2(videoTrack.frameSizeCv)) })
    }
    if (videoTrack.keyframeCount > 0) {
      metrics.push({ key: 'video_keyframes', value: String(videoTrack.keyframeCount) })
    }

    // Silent short video (extremely common for raw AI video outputs: Sora, Runway, Kling, Wan, Luma, CogVideoX)
    if (!hasAudioTrack && durationSec > 0.5 && durationSec <= 25) {
      findings.push({
        id: 'vid_silent_short_clip',
        category: 'container',
        severity: 'medium',
        scoreDelta: 15,
        titleTr: `Ses kanalı olmayan kısa video klibi (${round2(durationSec)} sn)`,
        titleEn: `Silent short video clip (${round2(durationSec)} s)`,
        detailTr: 'Kısa süreli videoda hiç ses (soun) izi bulunmuyor; ham AI video üreticilerinin çoğu sessiz klip üretir.',
        detailEn: 'Short video has zero audio tracks; many AI video generators output silent video-only MP4 files.',
        evidence: `tracks=${ctx.tracks.length}, audio=no, duration=${round2(durationSec)}s`
      })
    }

    // 4k+1 temporal VAE latent frame count (Wan, HunyuanVideo, CogVideoX, LTX-Video, Mochi)
    if (LATENT_VIDEO_FRAME_COUNTS.has(videoTrack.sampleCount)) {
      findings.push({
        id: 'vid_latent_4k_plus_1_frames',
        category: 'temporal',
        severity: 'high',
        scoreDelta: 18,
        titleTr: `3D-VAE zamansal difüzyon kare sayısı (${videoTrack.sampleCount} kare)`,
        titleEn: `3D-VAE temporal diffusion frame count (${videoTrack.sampleCount} frames)`,
        detailTr: `${videoTrack.sampleCount} kare sayısı (4k+1 / 8k+1 örüntüsü) Wan, CogVideoX, HunyuanVideo, LTX-Video gibi AI video modellerinin standart zamansal latent boyutudur.`,
        detailEn: `Exact frame count ${videoTrack.sampleCount} matches canonical 4k+1 / 8k+1 temporal VAE window sizes used by AI video diffusion models.`,
        evidence: `sampleCount=${videoTrack.sampleCount}`
      })
    }

    // AI video resolution match
    if (AI_VIDEO_RESOLUTIONS.has(dim) && ctx.cameraTags.length === 0) {
      findings.push({
        id: 'vid_canonical_ai_resolution',
        category: 'geometry',
        severity: 'medium',
        scoreDelta: 10,
        titleTr: `AI video üreticilerine özgü çözünürlük (${dim})`,
        titleEn: `Typical AI video generator resolution (${dim})`,
        detailTr: `${dim} boyutu güncel AI video üretim servislerinin standart çıktı profilleriyle eşleşiyor.`,
        detailEn: `Dimensions ${dim} align with standard output presets of AI video generators.`,
        evidence: dim
      })
    }

    // Perfectly uniform CFR single-entry stts + low frame-size variance
    if (videoTrack.sttsEntryCount === 1 && videoTrack.sampleCount >= 24 && videoTrack.frameSizeCv > 0 && videoTrack.frameSizeCv < 0.22) {
      findings.push({
        id: 'vid_uniform_cfr_bitrate',
        category: 'temporal',
        severity: 'medium',
        scoreDelta: 12,
        titleTr: 'Aşırı düzgün sabit kare hızı (CFR) ve tekdüze kare boyutu dağılımı',
        titleEn: 'Hyper-regular constant frame rate (CFR) and uniform frame-size distribution',
        detailTr: `Tek girişli stts tablosu ve çok düşük kare boyutu varyansı (CV=${round2(videoTrack.frameSizeCv)}) programatik sentetik kodlamaya işaret ediyor.`,
        detailEn: `Single-entry stts table combined with unusually low frame-size CV (${round2(videoTrack.frameSizeCv)}) indicates synthetic/programmatic rendering.`,
        evidence: `sttsEntries=1, frameSizeCV=${round2(videoTrack.frameSizeCv)}`
      })
    }
  }
}

function analyzeWebmOrAvi(
  buf: Uint8Array,
  format: string,
  findings: ForensicFinding[],
  metadata: KeyValueEntry[],
  textSources: string[]
): void {
  const runs = extractAsciiRuns(buf, 5, Math.min(buf.length, 131072))
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i]!
    textSources.push(r)
    const lower = r.toLowerCase()
    if (lower.indexOf('lavf') >= 0 || lower.indexOf('chrome') >= 0 || lower.indexOf('libwebm') >= 0) {
      metadata.push({ key: 'container_app', value: r.slice(0, 120) })
    }
  }

  if (format === 'AVI' && buf.length >= 64) {
    const avihIdx = asciiAt(buf, 24, 4) === 'avih' ? 24 : -1
    if (avihIdx >= 0 && avihIdx + 48 <= buf.length) {
      const microSecPerFrame = readU32LE(buf, avihIdx + 8)
      const totalFrames = readU32LE(buf, avihIdx + 24)
      const width = readU32LE(buf, avihIdx + 40)
      const height = readU32LE(buf, avihIdx + 44)
      if (width > 0 && height > 0) metadata.push({ key: 'video_dimensions', value: `${width}x${height}` })
      if (totalFrames > 0) metadata.push({ key: 'video_frame_count', value: String(totalFrames) })
      if (microSecPerFrame > 0) metadata.push({ key: 'video_fps', value: String(round2(1000000 / microSecPerFrame)) })
      if (LATENT_VIDEO_FRAME_COUNTS.has(totalFrames)) {
        findings.push({
          id: 'vid_avi_latent_frames',
          category: 'temporal',
          severity: 'high',
          scoreDelta: 18,
          titleTr: `3D-VAE zamansal difüzyon kare sayısı (${totalFrames} kare)`,
          titleEn: `3D-VAE temporal diffusion frame count (${totalFrames} frames)`,
          detailTr: `AVI başlığındaki ${totalFrames} kare sayısı AI video difüzyon modellerinin 4k+1 çıktı penceresiyle eşleşiyor.`,
          detailEn: `AVI header frame count ${totalFrames} matches AI video diffusion 4k+1 window lengths.`,
          evidence: `totalFrames=${totalFrames}`
        })
      }
    }
  }
}

export function analyzeVideo(buf: Uint8Array, format: string): AnalyzerResult {
  const findings: ForensicFinding[] = []
  const metadata: KeyValueEntry[] = []
  const metrics: KeyValueEntry[] = []
  const generatorHints: string[] = []
  const textSources: string[] = []

  metrics.push({ key: 'file_shannon_entropy', value: String(round2(shannonEntropy(buf))) })

  if (format === 'MP4' || format === 'MOV') {
    analyzeMp4Family(buf, findings, metadata, metrics, textSources)
  } else {
    analyzeWebmOrAvi(buf, format, findings, metadata, textSources)
  }

  const binScan = scanBinaryForC2paAndXmp(buf, 'video')
  for (let i = 0; i < binScan.findings.length; i++) findings.push(binScan.findings[i]!)
  for (let i = 0; i < binScan.generators.length; i++) addUnique(generatorHints, binScan.generators[i]!)

  const textScan = scanTextForAiSignatures(textSources, 'video')
  for (let i = 0; i < textScan.findings.length; i++) findings.push(textScan.findings[i]!)
  for (let i = 0; i < textScan.generators.length; i++) addUnique(generatorHints, textScan.generators[i]!)

  return {
    mediaCategory: 'video',
    detectedFormat: format,
    findings,
    metadata,
    metrics,
    generatorHints
  }
}
