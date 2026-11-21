import type { AnalyzerResult, ForensicFinding, KeyValueEntry } from '../types.ts'
import {
  asciiAt,
  extractAsciiRuns,
  printableSlice,
  readF32LE,
  readI16LE,
  readI32LE,
  readU16LE,
  readU32BE,
  readU32LE,
  round2,
  shannonEntropy
} from '../bytes.ts'
import {
  addUnique,
  scanBinaryForC2paAndXmp,
  scanTextForAiSignatures
} from '../signatures.ts'

interface DecodedAudio {
  sampleRate: number
  channels: number
  bitsPerSample: number
  samples: Float64Array
}

// In-place iterative Radix-2 Cooley-Tukey FFT (N must be power of 2)
function fftRadix2(re: Float64Array, im: Float64Array): void {
  const n = re.length
  let j = 0
  for (let i = 1; i < n; i++) {
    let bit = n >> 1
    while ((j & bit) !== 0) {
      j ^= bit
      bit >>= 1
    }
    j ^= bit
    if (i < j) {
      const tr = re[i]!
      re[i] = re[j]!
      re[j] = tr
      const ti = im[i]!
      im[i] = im[j]!
      im[j] = ti
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const halfLen = len >> 1
    const angle = (-2 * Math.PI) / len
    const wLenRe = Math.cos(angle)
    const wLenIm = Math.sin(angle)
    for (let i = 0; i < n; i += len) {
      let wRe = 1
      let wIm = 0
      for (let k = 0; k < halfLen; k++) {
        const uRe = re[i + k]!
        const uIm = im[i + k]!
        const vRe = re[i + k + halfLen]! * wRe - im[i + k + halfLen]! * wIm
        const vIm = re[i + k + halfLen]! * wIm + im[i + k + halfLen]! * wRe
        re[i + k] = uRe + vRe
        im[i + k] = uIm + vIm
        re[i + k + halfLen] = uRe - vRe
        im[i + k + halfLen] = uIm - vIm
        const nextRe = wRe * wLenRe - wIm * wLenIm
        wIm = wRe * wLenIm + wIm * wLenRe
        wRe = nextRe
      }
    }
  }
}

function analyzePcmSignal(
  audio: DecodedAudio,
  findings: ForensicFinding[],
  metrics: KeyValueEntry[]
): void {
  const samples = audio.samples
  const n = samples.length
  const sr = audio.sampleRate
  if (n < 1024 || sr < 8000) return

  const durationSec = n / sr
  metrics.push({ key: 'audio_duration_sec', value: String(round2(durationSec)) })
  metrics.push({ key: 'audio_sample_rate', value: `${sr} Hz` })
  metrics.push({ key: 'audio_channels', value: String(audio.channels) })

  // 1. Waveform statistics: RMS, peak, crest factor, digital-zero exactness, silence-floor frames
  let sumSq = 0
  let peak = 0
  let exactZeroCount = 0
  for (let i = 0; i < n; i++) {
    const v = samples[i]!
    const av = Math.abs(v)
    sumSq += v * v
    if (av > peak) peak = av
    if (av < 1e-6) exactZeroCount++
  }
  const rms = Math.sqrt(sumSq / n)
  const crestFactor = rms > 1e-9 ? peak / rms : 0
  const exactZeroRatio = exactZeroCount / n

  // Analyze 20ms frames for silence floor & envelope dynamics
  const frameSize = Math.max(160, Math.floor(sr * 0.02))
  const totalFrames = Math.floor(n / frameSize)
  let sterileQuietFrames = 0
  let naturalRoomToneFrames = 0
  let activeFrames = 0
  let activeRmsSum = 0
  let activeRmsSq = 0
  let zcrSum = 0
  let zcrSq = 0

  for (let f = 0; f < totalFrames; f++) {
    const start = f * frameSize
    let fSq = 0
    let zc = 0
    let prev = samples[start]!
    for (let i = 0; i < frameSize; i++) {
      const s = samples[start + i]!
      fSq += s * s
      if ((s >= 0 && prev < 0) || (s < 0 && prev >= 0)) zc++
      prev = s
    }
    const fRms = Math.sqrt(fSq / frameSize)
    const fDb = fRms > 1e-9 ? 20 * Math.log10(fRms) : -120
    if (fDb < -82) {
      sterileQuietFrames++
    } else if (fDb >= -68 && fDb < -36) {
      naturalRoomToneFrames++
    } else if (fDb >= -36) {
      activeFrames++
      activeRmsSum += fRms
      activeRmsSq += fRms * fRms
      const zcr = zc / frameSize
      zcrSum += zcr
      zcrSq += zcr * zcr
    }
  }

  const sterileSilenceRatio = totalFrames > 0 ? sterileQuietFrames / totalFrames : 0
  const roomToneRatio = totalFrames > 0 ? naturalRoomToneFrames / totalFrames : 0
  const activeRmsMean = activeFrames > 0 ? activeRmsSum / activeFrames : 0
  const activeRmsCv =
    activeFrames > 1 && activeRmsMean > 1e-9
      ? Math.sqrt(Math.max(0, activeRmsSq / activeFrames - activeRmsMean * activeRmsMean)) / activeRmsMean
      : 0

  // 2. Hann-windowed 1024-point STFT across up to 80 evenly spaced active/all frames
  const fftSize = 1024
  const halfBins = fftSize >> 1
  const hann = new Float64Array(fftSize)
  for (let i = 0; i < fftSize; i++) {
    hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)))
  }

  const avgPower = new Float64Array(halfBins)
  const re = new Float64Array(fftSize)
  const im = new Float64Array(fftSize)
  const maxStftFrames = 80
  const maxStart = n - fftSize
  const stftStep = Math.max(fftSize >> 1, Math.floor(maxStart / maxStftFrames))
  let stftCount = 0

  for (let pos = 0; pos <= maxStart && stftCount < maxStftFrames; pos += stftStep) {
    let frameEnergy = 0
    for (let i = 0; i < fftSize; i++) {
      const s = samples[pos + i]!
      frameEnergy += s * s
      re[i] = s * hann[i]!
      im[i] = 0
    }
    if (frameEnergy / fftSize < 1e-7) continue
    fftRadix2(re, im)
    for (let b = 0; b < halfBins; b++) {
      avgPower[b] = avgPower[b]! + re[b]! * re[b]! + im[b]! * im[b]!
    }
    stftCount++
  }

  let spectralFlatness = 0
  let dropAt8kDb = 0
  let dropAt11kDb = 0
  let dropAt12kDb = 0
  let highBandRatioDb = 0
  let vocoderCombPeak = 0

  if (stftCount > 0) {
    for (let b = 0; b < halfBins; b++) {
      avgPower[b] = avgPower[b]! / stftCount
    }

    const binFreq = sr / fftSize
    const bandMeanDb = (fLow: number, fHigh: number): number => {
      const b0 = Math.max(1, Math.floor(fLow / binFreq))
      const b1 = Math.min(halfBins - 1, Math.floor(fHigh / binFreq))
      if (b1 <= b0) return -120
      let sum = 0
      for (let b = b0; b <= b1; b++) sum += avgPower[b]!
      const mean = sum / (b1 - b0 + 1)
      return mean > 1e-18 ? 10 * Math.log10(mean) : -120
    }

    const coreDb = bandMeanDb(300, 3800)
    const midHighDb = bandMeanDb(4000, 7400)
    const band8to10Db = bandMeanDb(8200, 10400)
    const band8to11Db = bandMeanDb(8000, 10800)
    const band11to15Db = bandMeanDb(11200, 15000)
    const band12to18Db = bandMeanDb(12200, 18000)

    if (sr >= 24000) {
      dropAt8kDb = midHighDb - band8to10Db
    }
    if (sr >= 32000) {
      dropAt11kDb = band8to11Db - band11to15Db
      dropAt12kDb = bandMeanDb(9000, 11800) - band12to18Db
      highBandRatioDb = band11to15Db - coreDb
    }

    // Wiener entropy (spectral flatness) in 1 kHz - 7 kHz
    const sf0 = Math.max(1, Math.floor(1000 / binFreq))
    const sf1 = Math.min(halfBins - 1, Math.floor(7000 / binFreq))
    if (sf1 > sf0) {
      let logSum = 0
      let linSum = 0
      const cnt = sf1 - sf0 + 1
      for (let b = sf0; b <= sf1; b++) {
        const p = Math.max(avgPower[b]!, 1e-18)
        logSum += Math.log(p)
        linSum += p
      }
      const geom = Math.exp(logSum / cnt)
      const arith = linSum / cnt
      spectralFlatness = arith > 1e-18 ? geom / arith : 0
    }

    // Check high-band spectral comb regularity (vocoder upsampling ripples between 3kHz and 10kHz)
    const cb0 = Math.max(2, Math.floor(3000 / binFreq))
    const cb1 = Math.min(halfBins - 2, Math.floor(Math.min(10000, sr * 0.45) / binFreq))
    if (cb1 - cb0 > 24) {
      const logSpec = new Float64Array(cb1 - cb0)
      let meanL = 0
      for (let i = 0; i < logSpec.length; i++) {
        const v = Math.log10(Math.max(avgPower[cb0 + i]!, 1e-18))
        logSpec[i] = v
        meanL += v
      }
      meanL /= logSpec.length
      for (let i = 0; i < logSpec.length; i++) logSpec[i] = logSpec[i]! - meanL

      let maxAc = 0
      for (let lag = 4; lag <= 16; lag++) {
        let dot = 0
        let na = 0
        let nb = 0
        for (let i = 0; i < logSpec.length - lag; i++) {
          const a = logSpec[i]!
          const b = logSpec[i + lag]!
          dot += a * b
          na += a * a
          nb += b * b
        }
        const denom = Math.sqrt(na * nb)
        if (denom > 1e-9) {
          const ac = dot / denom
          if (ac > maxAc) maxAc = ac
        }
      }
      vocoderCombPeak = maxAc
    }
  }

  metrics.push({ key: 'audio_rms_dbfs', value: `${round2(rms > 1e-9 ? 20 * Math.log10(rms) : -120)} dBFS` })
  metrics.push({ key: 'audio_crest_factor', value: String(round2(crestFactor)) })
  metrics.push({ key: 'audio_exact_zero_ratio', value: `${round2(exactZeroRatio * 100)}%` })
  metrics.push({ key: 'audio_sterile_silence_ratio', value: `${round2(sterileSilenceRatio * 100)}%` })
  metrics.push({ key: 'audio_room_tone_ratio', value: `${round2(roomToneRatio * 100)}%` })
  metrics.push({ key: 'audio_envelope_cv', value: String(round2(activeRmsCv)) })
  metrics.push({ key: 'audio_spectral_flatness', value: String(round2(spectralFlatness)) })
  if (sr >= 24000) metrics.push({ key: 'audio_8khz_cutoff_drop_db', value: `${round2(dropAt8kDb)} dB` })
  if (sr >= 32000) metrics.push({ key: 'audio_11khz_cutoff_drop_db', value: `${round2(dropAt11kDb)} dB` })
  if (vocoderCombPeak > 0) metrics.push({ key: 'audio_vocoder_comb_peak', value: String(round2(vocoderCombPeak)) })

  // Forensic Rules on Audio DSP
  const maxCutoffDrop = Math.max(dropAt8kDb, dropAt11kDb, dropAt12kDb)
  const cutoffFreqLabel =
    maxCutoffDrop === dropAt8kDb ? '~8 kHz' : maxCutoffDrop === dropAt11kDb ? '~11 kHz' : '~12 kHz'

  if (maxCutoffDrop >= 26 && stftCount >= 4) {
    findings.push({
      id: 'aud_neural_vocoder_brickwall',
      category: 'dsp',
      severity: 'high',
      scoreDelta: 26,
      titleTr: `Keskin yüksek frekans spektral kesilme (${cutoffFreqLabel}, -${round2(maxCutoffDrop)} dB)`,
      titleEn: `Sharp high-frequency spectral brickwall (${cutoffFreqLabel}, -${round2(maxCutoffDrop)} dB)`,
      detailTr: `${sr} Hz örnekleme hızına rağmen ${cutoffFreqLabel} üzerinde sert enerji çöküşü tespit edildi; HiFi-GAN / EnCodec / TTS sinir vocoder çıktılarında karakteristik bir izdir.`,
      detailEn: `Abrupt spectral cliff above ${cutoffFreqLabel} inside a ${sr} Hz stream — a known artifact of 16/22/24 kHz neural vocoders (HiFi-GAN, EnCodec, TTS).`,
      evidence: `drop8k=${round2(dropAt8kDb)}dB, drop11k=${round2(dropAt11kDb)}dB, drop12k=${round2(dropAt12kDb)}dB`
    })
  }

  if (sterileSilenceRatio >= 0.08 && roomToneRatio < 0.03 && activeFrames > 0) {
    findings.push({
      id: 'aud_sterile_digital_silence',
      category: 'dsp',
      severity: 'high',
      scoreDelta: 22,
      titleTr: 'Doğal ortam gürültüsü olmayan dijital sıfır sessizlik tabanı',
      titleEn: 'Sterile digital-zero silence floor (no natural room tone)',
      detailTr: `Duraklamaların %${round2(sterileSilenceRatio * 100)}'i -82 dBFS altında dijital sessizlik içeriyor (ortam sesi %${round2(roomToneRatio * 100)}). Gerçek mikrofon kayıtlarında sürekli oda/termal gürültü tabanı bulunur.`,
      detailEn: `${round2(sterileSilenceRatio * 100)}% of frames fall below -82 dBFS with almost no natural room tone (${round2(roomToneRatio * 100)}%), typical of synthetic TTS/vocoder pauses.`,
      evidence: `sterile=${round2(sterileSilenceRatio * 100)}%, exactZero=${round2(exactZeroRatio * 100)}%, roomTone=${round2(roomToneRatio * 100)}%`
    })
  } else if (roomToneRatio >= 0.12 && maxCutoffDrop < 16 && exactZeroRatio < 0.01) {
    findings.push({
      id: 'aud_natural_microphone_floor',
      category: 'dsp',
      severity: 'authentic',
      scoreDelta: -18,
      titleTr: 'Doğal mikrofon ortam gürültüsü ve kesintisiz spektrum',
      titleEn: 'Natural microphone room-tone floor and continuous spectrum',
      detailTr: `Kayıtta doğal oda/mikrofon gürültü tabanı (%${round2(roomToneRatio * 100)}) mevcut ve keskin vocoder bant kesilmesi tespit edilmedi.`,
      detailEn: `Continuous natural room/microphone noise floor (${round2(roomToneRatio * 100)}%) with no abrupt neural-vocoder spectral cutoff.`,
      evidence: `roomTone=${round2(roomToneRatio * 100)}%, maxCutoffDrop=${round2(maxCutoffDrop)}dB`
    })
  }

  if (vocoderCombPeak >= 0.58 && stftCount >= 4) {
    findings.push({
      id: 'aud_vocoder_harmonic_comb',
      category: 'dsp',
      severity: 'medium',
      scoreDelta: 14,
      titleTr: 'Yüksek frekansta periyodik vocoder tarak (comb) izi',
      titleEn: 'Periodic high-band vocoder comb artifact',
      detailTr: `3–10 kHz bandında yüksek spektral periyodiklik (tepe=${round2(vocoderCombPeak)}) gözlemlendi.`,
      detailEn: `Elevated periodic spectral comb autocorrelation (peak=${round2(vocoderCombPeak)}) in the 3–10 kHz band.`,
      evidence: `vocoderCombPeak=${round2(vocoderCombPeak)}`
    })
  }

  if (sr === 22050 || sr === 24000) {
    findings.push({
      id: 'aud_tts_sample_rate',
      category: 'container',
      severity: 'low',
      scoreDelta: 10,
      titleTr: `TTS / sinir sesi örnekleme hızı (${sr} Hz)`,
      titleEn: `Common neural TTS sample rate (${sr} Hz)`,
      detailTr: `${sr} Hz örnekleme hızı OpenAI TTS, XTTS, Kokoro, Piper ve ElevenLabs gibi yapay ses modellerinin varsayılan çıktı frekansıdır.`,
      detailEn: `${sr} Hz is the default native sample rate of neural TTS engines (OpenAI TTS, XTTS, Kokoro, Piper, ElevenLabs).`,
      evidence: `sampleRate=${sr}`
    })
  }
}

function analyzeWav(
  buf: Uint8Array,
  findings: ForensicFinding[],
  metadata: KeyValueEntry[],
  metrics: KeyValueEntry[],
  textSources: string[]
): void {
  let offset = 12
  let audioFormat = 0
  let channels = 0
  let sampleRate = 0
  let bitsPerSample = 0
  let dataStart = 0
  let dataSize = 0
  let hasBext = false

  while (offset + 8 <= buf.length) {
    const id = asciiAt(buf, offset, 4)
    const size = readU32LE(buf, offset + 4)
    const chunkStart = offset + 8
    const chunkEnd = Math.min(buf.length, chunkStart + size)

    if (id === 'fmt ' && size >= 16) {
      audioFormat = readU16LE(buf, chunkStart)
      channels = readU16LE(buf, chunkStart + 2)
      sampleRate = readU32LE(buf, chunkStart + 4)
      bitsPerSample = readU16LE(buf, chunkStart + 14)
      metadata.push({
        key: 'wav_format',
        value: `${audioFormat === 1 ? 'PCM' : audioFormat === 3 ? 'IEEE_FLOAT' : `fmt_${audioFormat}`} ${bitsPerSample}-bit ${sampleRate}Hz ${channels}ch`
      })
    } else if (id === 'data') {
      dataStart = chunkStart
      dataSize = chunkEnd - chunkStart
    } else if (id === 'LIST' && size >= 4 && asciiAt(buf, chunkStart, 4) === 'INFO') {
      let p = chunkStart + 4
      while (p + 8 <= chunkEnd) {
        const subId = asciiAt(buf, p, 4)
        const subSz = readU32LE(buf, p + 4)
        const subEnd = Math.min(chunkEnd, p + 8 + subSz)
        const val = printableSlice(buf, p + 8, subEnd, 512).trim()
        if (val.length > 0) {
          metadata.push({ key: `wav_info_${subId}`, value: val })
          textSources.push(`${subId}: ${val}`)
        }
        p = p + 8 + subSz + (subSz & 1)
      }
    } else if (id === 'bext') {
      hasBext = true
      const desc = printableSlice(buf, chunkStart, Math.min(chunkEnd, chunkStart + 320), 320).trim()
      if (desc.length > 0) {
        metadata.push({ key: 'wav_bext', value: desc.slice(0, 140) })
        textSources.push(desc)
      }
    } else if (id === 'id3 ' || id === 'ID3 ' || id === 'iXML' || id === 'C2PA') {
      textSources.push(printableSlice(buf, chunkStart, chunkEnd, 8192))
    }

    offset = chunkStart + size + (size & 1)
  }

  if (hasBext) {
    findings.push({
      id: 'aud_broadcast_wave_bext',
      category: 'provenance',
      severity: 'authentic',
      scoreDelta: -12,
      titleTr: 'Broadcast Wave (BEXT) profesyonel kayıt başlığı mevcut',
      titleEn: 'Broadcast Wave (BEXT) field-recorder header present',
      detailTr: 'BEXT bloğu genellikle profesyonel ses kayıt cihazları ve DAW yazılımları tarafından yazılır.',
      detailEn: 'BEXT chunk is typically written by field recorders (Zoom/Tascam/Sound Devices) and DAWs.',
      evidence: 'bext chunk'
    })
  }

  // Decode mono mixdown (up to first 15 seconds / 720,000 samples) for fast native DSP
  if (dataSize > 0 && channels > 0 && sampleRate > 0 && (audioFormat === 1 || audioFormat === 3)) {
    const bytesPerSample = bitsPerSample >> 3
    const frameBytes = bytesPerSample * channels
    if (bytesPerSample > 0 && frameBytes > 0) {
      const totalFrames = Math.floor(dataSize / frameBytes)
      const maxFrames = Math.min(totalFrames, Math.min(sampleRate * 15, 720000))
      const mono = new Float64Array(maxFrames)

      for (let i = 0; i < maxFrames; i++) {
        let sum = 0
        const framePos = dataStart + i * frameBytes
        for (let ch = 0; ch < channels; ch++) {
          const p = framePos + ch * bytesPerSample
          let s = 0
          if (audioFormat === 1 && bitsPerSample === 16) {
            s = readI16LE(buf, p) / 32768
          } else if (audioFormat === 1 && bitsPerSample === 8) {
            s = (buf[p]! - 128) / 128
          } else if (audioFormat === 1 && bitsPerSample === 24) {
            let v = buf[p]! | (buf[p + 1]! << 8) | (buf[p + 2]! << 16)
            if ((v & 0x800000) !== 0) v -= 0x1000000
            s = v / 8388608
          } else if (audioFormat === 1 && bitsPerSample === 32) {
            s = readI32LE(buf, p) / 2147483648
          } else if (audioFormat === 3 && bitsPerSample === 32) {
            s = readF32LE(buf, p)
          }
          sum += s
        }
        mono[i] = sum / channels
      }

      analyzePcmSignal(
        {
          sampleRate,
          channels,
          bitsPerSample,
          samples: mono
        },
        findings,
        metrics
      )
    }
  }
}

const MPEG1_BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0]
const MPEG2_BITRATES = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0]
const MPEG1_RATES = [44100, 48000, 32000, 0]
const MPEG2_RATES = [22050, 24000, 16000, 0]
const MPEG25_RATES = [11025, 12000, 8000, 0]

function analyzeMp3(
  buf: Uint8Array,
  findings: ForensicFinding[],
  metadata: KeyValueEntry[],
  metrics: KeyValueEntry[],
  textSources: string[]
): void {
  let audioStart = 0

  // Parse ID3v2 header + text frames
  if (buf.length >= 10 && asciiAt(buf, 0, 3) === 'ID3') {
    const version = buf[3]!
    const tagSize =
      ((buf[6]! & 0x7f) << 21) |
      ((buf[7]! & 0x7f) << 14) |
      ((buf[8]! & 0x7f) << 7) |
      (buf[9]! & 0x7f)
    audioStart = Math.min(buf.length, 10 + tagSize)
    metadata.push({ key: 'id3_version', value: `ID3v2.${version}` })

    let p = 10
    while (p + 10 <= audioStart) {
      const frameId = asciiAt(buf, p, 4)
      if (frameId.charCodeAt(0) === 0) break
      const frameSize =
        version >= 4
          ? ((buf[p + 4]! & 0x7f) << 21) |
            ((buf[p + 5]! & 0x7f) << 14) |
            ((buf[p + 6]! & 0x7f) << 7) |
            (buf[p + 7]! & 0x7f)
          : readU32BE(buf, p + 4)
      if (frameSize <= 0 || p + 10 + frameSize > audioStart) break
      if (frameId.startsWith('T') || frameId === 'COMM' || frameId === 'USLT') {
        const val = printableSlice(buf, p + 11, p + 10 + frameSize, 1024).trim()
        if (val.length > 0) {
          metadata.push({ key: `id3_${frameId}`, value: val.slice(0, 160) })
          textSources.push(`${frameId}: ${val}`)
        }
      }
      p += 10 + frameSize
    }
  }

  // Parse ID3v1 trailer
  if (buf.length >= 128 && asciiAt(buf, buf.length - 128, 3) === 'TAG') {
    const tail = printableSlice(buf, buf.length - 125, buf.length, 125).trim()
    if (tail.length > 0) {
      metadata.push({ key: 'id3v1', value: tail.slice(0, 120) })
      textSources.push(tail)
    }
  }

  // Scan MPEG frames for sample rate, bitrate, channel mode, LAME/Lavf header
  let sampleRate = 0
  let bitrateKbps = 0
  let channels = 0
  let framesChecked = 0
  const bitratesSeen = new Set<number>()

  for (let i = audioStart; i + 4 < buf.length && framesChecked < 64; i++) {
    if (buf[i] === 0xff && (buf[i + 1]! & 0xe0) === 0xe0) {
      const verBits = (buf[i + 1]! >> 3) & 0x03
      const layerBits = (buf[i + 1]! >> 1) & 0x03
      const brIdx = (buf[i + 2]! >> 4) & 0x0f
      const srIdx = (buf[i + 2]! >> 2) & 0x03
      const pad = (buf[i + 2]! >> 1) & 0x01
      const chMode = (buf[i + 3]! >> 6) & 0x03
      if (verBits === 1 || layerBits !== 1 || brIdx === 0 || brIdx === 15 || srIdx === 3) continue

      const sr = verBits === 3 ? MPEG1_RATES[srIdx]! : verBits === 2 ? MPEG2_RATES[srIdx]! : MPEG25_RATES[srIdx]!
      const br = verBits === 3 ? MPEG1_BITRATES[brIdx]! : MPEG2_BITRATES[brIdx]!
      if (sr <= 0 || br <= 0) continue

      if (framesChecked === 0) {
        sampleRate = sr
        bitrateKbps = br
        channels = chMode === 3 ? 1 : 2
        // Inspect first frame payload for Xing / LAME / Lavc encoder string
        const headerSlice = printableSlice(buf, i, Math.min(buf.length, i + 256), 256)
        if (headerSlice.indexOf('LAME') >= 0 || headerSlice.indexOf('Lavc') >= 0 || headerSlice.indexOf('Lavf') >= 0) {
          textSources.push(headerSlice)
        }
      }
      bitratesSeen.add(br)
      framesChecked++

      const frameLen = Math.floor(((verBits === 3 ? 144 : 72) * br * 1000) / sr) + pad
      if (frameLen >= 24) i += frameLen - 1
    }
  }

  if (sampleRate > 0) {
    metrics.push({ key: 'audio_sample_rate', value: `${sampleRate} Hz` })
    metrics.push({ key: 'audio_bitrate_kbps', value: `${bitrateKbps} kbps` })
    metrics.push({ key: 'audio_channels', value: String(channels) })
    metrics.push({ key: 'mp3_bitrate_mode', value: bitratesSeen.size > 1 ? 'VBR' : 'CBR' })

    if ((sampleRate === 22050 || sampleRate === 24000) && channels === 1) {
      findings.push({
        id: 'aud_mp3_tts_profile',
        category: 'container',
        severity: 'medium',
        scoreDelta: 15,
        titleTr: `Tipik AI TTS MP3 profili (${sampleRate} Hz mono, ${bitrateKbps} kbps)`,
        titleEn: `Typical AI TTS MP3 profile (${sampleRate} Hz mono, ${bitrateKbps} kbps)`,
        detailTr: '22.05/24 kHz mono CBR MP3 profili ElevenLabs, OpenAI TTS ve benzeri ses sentez API\'lerinin yaygın çıktı formatıdır.',
        detailEn: '22.05/24 kHz mono CBR MP3 matches standard output presets of cloud TTS APIs (OpenAI TTS, ElevenLabs, etc.).',
        evidence: `${sampleRate}Hz mono ${bitrateKbps}kbps`
      })
    }
  }
}

function analyzeFlacOrOggOrM4a(
  buf: Uint8Array,
  format: string,
  metadata: KeyValueEntry[],
  metrics: KeyValueEntry[],
  textSources: string[]
): void {
  if (format === 'FLAC' && buf.length >= 42) {
    let offset = 4
    while (offset + 4 <= buf.length) {
      const header = buf[offset]!
      const isLast = (header & 0x80) !== 0
      const blockType = header & 0x7f
      const blockLen = (buf[offset + 1]! << 16) | (buf[offset + 2]! << 8) | buf[offset + 3]!
      const start = offset + 4
      const end = Math.min(buf.length, start + blockLen)

      if (blockType === 0 && blockLen >= 18) {
        const sr = (buf[start + 10]! << 12) | (buf[start + 11]! << 4) | (buf[start + 12]! >> 4)
        const ch = ((buf[start + 12]! >> 1) & 0x07) + 1
        metrics.push({ key: 'audio_sample_rate', value: `${sr} Hz` })
        metrics.push({ key: 'audio_channels', value: String(ch) })
      } else if (blockType === 4) {
        // VORBIS_COMMENT
        const vendorLen = readU32LE(buf, start)
        let p = start + 4
        if (vendorLen > 0 && p + vendorLen <= end) {
          const vendor = printableSlice(buf, p, p + vendorLen, 512)
          metadata.push({ key: 'flac_vendor', value: vendor })
          textSources.push(vendor)
          p += vendorLen
        }
        if (p + 4 <= end) {
          const commentCount = readU32LE(buf, p)
          p += 4
          for (let c = 0; c < Math.min(commentCount, 64) && p + 4 <= end; c++) {
            const cLen = readU32LE(buf, p)
            p += 4
            if (p + cLen > end) break
            const comment = printableSlice(buf, p, p + cLen, 512)
            textSources.push(comment)
            metadata.push({ key: `flac_tag_${c}`, value: comment.slice(0, 140) })
            p += cLen
          }
        }
      }

      offset = end
      if (isLast) break
    }
  } else {
    const runs = extractAsciiRuns(buf, 5, Math.min(buf.length, 65536))
    for (let i = 0; i < runs.length; i++) {
      textSources.push(runs[i]!)
    }
  }
}

export function analyzeAudio(buf: Uint8Array, format: string): AnalyzerResult {
  const findings: ForensicFinding[] = []
  const metadata: KeyValueEntry[] = []
  const metrics: KeyValueEntry[] = []
  const generatorHints: string[] = []
  const textSources: string[] = []

  metrics.push({ key: 'file_shannon_entropy', value: String(round2(shannonEntropy(buf))) })

  if (format === 'WAV') {
    analyzeWav(buf, findings, metadata, metrics, textSources)
  } else if (format === 'MP3') {
    analyzeMp3(buf, findings, metadata, metrics, textSources)
  } else {
    analyzeFlacOrOggOrM4a(buf, format, metadata, metrics, textSources)
  }

  const binScan = scanBinaryForC2paAndXmp(buf, 'audio')
  for (let i = 0; i < binScan.findings.length; i++) findings.push(binScan.findings[i]!)
  for (let i = 0; i < binScan.generators.length; i++) addUnique(generatorHints, binScan.generators[i]!)

  const textScan = scanTextForAiSignatures(textSources, 'audio')
  for (let i = 0; i < textScan.findings.length; i++) findings.push(textScan.findings[i]!)
  for (let i = 0; i < textScan.generators.length; i++) addUnique(generatorHints, textScan.generators[i]!)

  return {
    mediaCategory: 'audio',
    detectedFormat: format,
    findings,
    metadata,
    metrics,
    generatorHints
  }
}
