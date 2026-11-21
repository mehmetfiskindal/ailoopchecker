import { Buffer } from 'node:buffer'
import { inflateZlib } from '../inflate.ts'
import type { AnalyzerResult, ForensicFinding, KeyValueEntry } from '../types.ts'
import {
  asciiAt,
  indexOfAscii,
  printableSlice,
  readU16BE,
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

interface DecodedRgbImage {
  width: number
  height: number
  rgb: Uint8Array
}

interface ExifInfo {
  make: string
  model: string
  software: string
  dateTimeOriginal: string
  hasExposure: boolean
  hasFNumber: boolean
  hasIso: boolean
  hasFocalLength: boolean
  hasLens: boolean
  hasGps: boolean
}

const CANONICAL_AI_DIMS: string[] = [
  '512x512',
  '512x768',
  '768x512',
  '768x768',
  '768x1024',
  '1024x768',
  '1024x1024',
  '1024x1536',
  '1536x1024',
  '1024x1792',
  '1792x1024',
  '896x1152',
  '1152x896',
  '832x1216',
  '1216x832',
  '768x1344',
  '1344x768',
  '640x1536',
  '1536x640',
  '1024x576',
  '576x1024',
  '1280x768',
  '768x1280',
  '1408x768',
  '768x1408',
  '1536x1536',
  '2048x2048'
]

const KNOWN_CAMERA_MAKES: string[] = [
  'apple',
  'canon',
  'nikon',
  'sony',
  'fujifilm',
  'leica',
  'olympus',
  'om digital',
  'panasonic',
  'pentax',
  'ricoh',
  'hasselblad',
  'samsung',
  'google',
  'xiaomi',
  'huawei',
  'oneplus',
  'oppo',
  'vivo',
  'gopro',
  'dji',
  'sigma',
  'motorola'
]

function isKnownCameraMake(make: string): boolean {
  const lower = make.toLowerCase()
  for (let i = 0; i < KNOWN_CAMERA_MAKES.length; i++) {
    if (lower.indexOf(KNOWN_CAMERA_MAKES[i]!) >= 0) return true
  }
  return false
}

function isCanonicalAiDimension(w: number, h: number): boolean {
  const key = `${w}x${h}`
  for (let i = 0; i < CANONICAL_AI_DIMS.length; i++) {
    if (CANONICAL_AI_DIMS[i] === key) return true
  }
  return false
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

function decodePngPixels(
  width: number,
  height: number,
  bitDepth: number,
  colorType: number,
  interlace: number,
  idatChunks: Uint8Array[]
): DecodedRgbImage | null {
  if (bitDepth !== 8 || interlace !== 0) return null
  if (colorType !== 0 && colorType !== 2 && colorType !== 6) return null
  // Cap decoding at ~6 MP to stay fast and bounded in memory
  if (width <= 0 || height <= 0 || width * height > 6000000) return null
  if (idatChunks.length === 0) return null

  let totalCompressed = 0
  for (let i = 0; i < idatChunks.length; i++) {
    totalCompressed += idatChunks[i]!.length
  }
  if (totalCompressed === 0 || totalCompressed > 32 * 1024 * 1024) return null

  const compressed = Buffer.alloc(totalCompressed)
  let pos = 0
  for (let i = 0; i < idatChunks.length; i++) {
    const chunk = idatChunks[i]!
    compressed.set(chunk, pos)
    pos += chunk.length
  }

  let raw: Uint8Array
  try {
    raw = inflateZlib(compressed)
  } catch {
    return null
  }

  const bpp = colorType === 0 ? 1 : colorType === 2 ? 3 : 4
  const stride = width * bpp
  if (raw.length < height * (stride + 1)) return null

  const prev = new Uint8Array(stride)
  const curr = new Uint8Array(stride)
  const rgb = new Uint8Array(width * height * 3)

  let inPos = 0
  let outPos = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[inPos++]!
    for (let x = 0; x < stride; x++) {
      const xVal = raw[inPos++]!
      const a = x >= bpp ? curr[x - bpp]! : 0
      const b = prev[x]!
      const c = x >= bpp ? prev[x - bpp]! : 0
      let recon = 0
      if (filter === 0) recon = xVal
      else if (filter === 1) recon = (xVal + a) & 0xff
      else if (filter === 2) recon = (xVal + b) & 0xff
      else if (filter === 3) recon = (xVal + ((a + b) >> 1)) & 0xff
      else if (filter === 4) recon = (xVal + paethPredictor(a, b, c)) & 0xff
      else return null
      curr[x] = recon
    }

    if (colorType === 0) {
      for (let px = 0; px < width; px++) {
        const g = curr[px]!
        rgb[outPos++] = g
        rgb[outPos++] = g
        rgb[outPos++] = g
      }
    } else if (colorType === 2) {
      for (let px = 0; px < stride; px++) {
        rgb[outPos++] = curr[px]!
      }
    } else {
      for (let px = 0; px < stride; px += 4) {
        rgb[outPos++] = curr[px]!
        rgb[outPos++] = curr[px + 1]!
        rgb[outPos++] = curr[px + 2]!
      }
    }
    prev.set(curr)
  }

  return { width, height, rgb }
}

function decodeBmpPixels(buf: Uint8Array): DecodedRgbImage | null {
  if (buf.length < 54) return null
  const pixelOffset = readU32LE(buf, 10)
  const dibSize = readU32LE(buf, 14)
  if (dibSize < 40) return null
  const width = readU32LE(buf, 18)
  const rawHeight = readU32LE(buf, 22)
  const topDown = rawHeight >= 0x80000000
  const height = topDown ? 0x100000000 - rawHeight : rawHeight
  const bitsPerPixel = readU16LE(buf, 28)
  const compression = readU32LE(buf, 30)
  if (compression !== 0 || (bitsPerPixel !== 24 && bitsPerPixel !== 32)) return null
  if (width <= 0 || height <= 0 || width * height > 6000000) return null

  const bytesPerPixel = bitsPerPixel / 8
  const rowStride = Math.floor((width * bitsPerPixel + 31) / 32) * 4
  if (pixelOffset + rowStride * height > buf.length) return null

  const rgb = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y++) {
    const srcY = topDown ? y : height - 1 - y
    const rowStart = pixelOffset + srcY * rowStride
    let dst = y * width * 3
    for (let x = 0; x < width; x++) {
      const p = rowStart + x * bytesPerPixel
      rgb[dst++] = buf[p + 2]!
      rgb[dst++] = buf[p + 1]!
      rgb[dst++] = buf[p]!
    }
  }

  return { width, height, rgb }
}

function analyzeDecodedPixels(
  img: DecodedRgbImage,
  findings: ForensicFinding[],
  metrics: KeyValueEntry[]
): void {
  const w = img.width
  const h = img.height
  if (w < 32 || h < 32) return

  // Compute luminance plane and high-frequency Laplacian residual
  const luma = new Float64Array(w * h)
  const rgb = img.rgb
  for (let i = 0; i < w * h; i++) {
    const r = rgb[i * 3]!
    const g = rgb[i * 3 + 1]!
    const b = rgb[i * 3 + 2]!
    luma[i] = 0.299 * r + 0.587 * g + 0.114 * b
  }

  // Laplacian residual = 4*L(x,y) - L(x-1,y) - L(x+1,y) - L(x,y-1) - L(x,y+1)
  const resW = w - 2
  const resH = h - 2
  const residual = new Float64Array(resW * resH)
  let sumAbsRes = 0
  let sumSqRes = 0
  for (let y = 1; y < h - 1; y++) {
    const row = y * w
    const outRow = (y - 1) * resW
    for (let x = 1; x < w - 1; x++) {
      const val =
        4 * luma[row + x]! -
        luma[row + x - 1]! -
        luma[row + x + 1]! -
        luma[row - w + x]! -
        luma[row + w + x]!
      residual[outRow + x - 1] = val
      sumAbsRes += Math.abs(val)
      sumSqRes += val * val
    }
  }

  const nRes = resW * resH
  const meanAbsRes = sumAbsRes / nRes
  const rmsRes = Math.sqrt(sumSqRes / nRes)

  // Compute horizontal residual autocorrelation at lags 1..8 (detects 2x/4x/8x upsampler / VAE latent grid)
  const stepY = resH > 256 ? Math.floor(resH / 256) : 1
  const corr = new Float64Array(9)
  for (let lag = 1; lag <= 8; lag++) {
    let dot = 0
    let normA = 0
    let normB = 0
    for (let y = 0; y < resH; y += stepY) {
      const row = y * resW
      for (let x = 0; x < resW - lag; x++) {
        const a = residual[row + x]!
        const b = residual[row + x + lag]!
        dot += a * b
        normA += a * a
        normB += b * b
      }
    }
    const denom = Math.sqrt(normA * normB)
    corr[lag] = denom > 1e-9 ? dot / denom : 0
  }

  // Periodic spike at lag 2, 4, or 8 compared to neighboring odd lags (3, 5, 7)
  const oddMean = (Math.abs(corr[3]!) + Math.abs(corr[5]!) + Math.abs(corr[7]!)) / 3
  const lag2Peak = Math.abs(corr[2]!) - oddMean
  const lag4Peak = Math.abs(corr[4]!) - oddMean
  const lag8Peak = Math.abs(corr[8]!) - oddMean
  const maxGridPeak = Math.max(lag2Peak, lag4Peak, lag8Peak)

  // Block-level noise uniformity (8x8 patches)
  const bxCount = Math.floor(resW / 8)
  const byCount = Math.floor(resH / 8)
  let blockMean = 0
  let blockSq = 0
  let blockN = 0
  const bStepY = byCount > 32 ? Math.floor(byCount / 32) : 1
  const bStepX = bxCount > 32 ? Math.floor(bxCount / 32) : 1
  for (let by = 0; by < byCount; by += bStepY) {
    for (let bx = 0; bx < bxCount; bx += bStepX) {
      let s = 0
      for (let dy = 0; dy < 8; dy++) {
        const row = (by * 8 + dy) * resW + bx * 8
        for (let dx = 0; dx < 8; dx++) {
          s += Math.abs(residual[row + dx]!)
        }
      }
      const m = s / 64
      blockMean += m
      blockSq += m * m
      blockN++
    }
  }
  const bAvg = blockN > 0 ? blockMean / blockN : 0
  const bStd = blockN > 0 ? Math.sqrt(Math.max(0, blockSq / blockN - bAvg * bAvg)) : 0
  const blockCv = bAvg > 1e-6 ? bStd / bAvg : 0

  // RGB channel residual cross-correlation (R-G vs B-G)
  let rgDot = 0
  let rNorm = 0
  let gNorm = 0
  const pixStep = w * h > 65536 ? Math.floor((w * h) / 65536) : 1
  for (let i = 1; i < w * h - 1; i += pixStep) {
    const dr = rgb[i * 3]! - rgb[(i - 1) * 3]!
    const dg = rgb[i * 3 + 1]! - rgb[(i - 1) * 3 + 1]!
    rgDot += dr * dg
    rNorm += dr * dr
    gNorm += dg * dg
  }
  const rgCorr = Math.sqrt(rNorm * gNorm) > 1e-9 ? rgDot / Math.sqrt(rNorm * gNorm) : 0

  metrics.push({ key: 'pixel_laplacian_rms', value: String(round2(rmsRes)) })
  metrics.push({ key: 'pixel_laplacian_mean_abs', value: String(round2(meanAbsRes)) })
  metrics.push({ key: 'pixel_grid_autocorr_peak', value: String(round2(maxGridPeak)) })
  metrics.push({ key: 'pixel_lag8_autocorr', value: String(round2(corr[8]!)) })
  metrics.push({ key: 'pixel_block_variance_cv', value: String(round2(blockCv)) })
  metrics.push({ key: 'pixel_rg_diff_corr', value: String(round2(rgCorr)) })

  if (maxGridPeak > 0.14) {
    findings.push({
      id: 'img_upsampler_grid_periodicity',
      category: 'signal',
      severity: 'high',
      scoreDelta: 24,
      titleTr: 'Sinir ağı upsampler / VAE latent ızgara periyodikliği tespit edildi',
      titleEn: 'Neural upsampler / VAE latent grid periodicity detected',
      detailTr: `Yüksek frekanslı piksel kalıntılarında 2/4/8 piksel aralıklı periyodik otokorelasyon sıçraması (tepe=${round2(maxGridPeak)}, lag8=${round2(corr[8]!)}) gözlemlendi.`,
      detailEn: `Periodic autocorrelation peak at 2/4/8-pixel strides (peak=${round2(maxGridPeak)}, lag8=${round2(corr[8]!)}) detected in high-frequency pixel residuals.`,
      evidence: `lag2=${round2(corr[2]!)} lag4=${round2(corr[4]!)} lag8=${round2(corr[8]!)} oddMean=${round2(oddMean)}`
    })
  }

  if (meanAbsRes > 0.2 && meanAbsRes < 3.2 && blockCv < 0.42) {
    findings.push({
      id: 'img_overly_smooth_noise_floor',
      category: 'signal',
      severity: 'medium',
      scoreDelta: 14,
      titleTr: 'Aşırı pürüzsüz / sentetik yüksek frekans gürültü profili',
      titleEn: 'Unnaturally smooth high-frequency noise floor',
      detailTr: `Gerçek kamera sensör gürültüsü yerine çok düşük ve homojen bir yüksek frekans kalıntısı (meanAbs=${round2(meanAbsRes)}, CV=${round2(blockCv)}) ölçüldü.`,
      detailEn: `Very low and spatially uniform high-frequency residual (meanAbs=${round2(meanAbsRes)}, CV=${round2(blockCv)}) instead of natural camera sensor noise.`,
      evidence: `meanAbsRes=${round2(meanAbsRes)}, blockCv=${round2(blockCv)}`
    })
  } else if (meanAbsRes >= 5.5 && maxGridPeak < 0.06 && blockCv >= 0.55) {
    findings.push({
      id: 'img_natural_sensor_noise',
      category: 'signal',
      severity: 'authentic',
      scoreDelta: -10,
      titleTr: 'Doğal sensör/doku yüksek frekans dağılımı',
      titleEn: 'Natural sensor/texture high-frequency distribution',
      detailTr: 'Piksel kalıntılarında periyodik yapay ızgara tespit edilmedi ve bölgesel varyans dağılımı doğal aralıkta.',
      detailEn: 'No periodic synthetic upsampling grid detected and spatial noise variance is in the natural range.',
      evidence: `meanAbsRes=${round2(meanAbsRes)}, gridPeak=${round2(maxGridPeak)}, blockCv=${round2(blockCv)}`
    })
  }
}

function parseExifBlock(buf: Uint8Array, tiffStart: number, maxEnd: number): ExifInfo {
  const info: ExifInfo = {
    make: '',
    model: '',
    software: '',
    dateTimeOriginal: '',
    hasExposure: false,
    hasFNumber: false,
    hasIso: false,
    hasFocalLength: false,
    hasLens: false,
    hasGps: false
  }
  if (tiffStart + 8 > maxEnd) return info

  const byteOrder = asciiAt(buf, tiffStart, 2)
  const littleEndian = byteOrder === 'II'
  if (!littleEndian && byteOrder !== 'MM') return info

  const read16 = (off: number): number => (littleEndian ? readU16LE(buf, off) : readU16BE(buf, off))
  const read32 = (off: number): number => (littleEndian ? readU32LE(buf, off) : readU32BE(buf, off))

  if (read16(tiffStart + 2) !== 42) return info
  const ifd0Rel = read32(tiffStart + 4)
  let exifIfdRel = 0

  const readAsciiTag = (count: number, valueOffsetPos: number): string => {
    if (count <= 0 || count > 512) return ''
    let startPos = valueOffsetPos
    if (count > 4) {
      const rel = read32(valueOffsetPos)
      startPos = tiffStart + rel
    }
    if (startPos < tiffStart || startPos + count > maxEnd) return ''
    let s = ''
    for (let i = 0; i < count; i++) {
      const b = buf[startPos + i]!
      if (b === 0) break
      if (b >= 32 && b <= 126) s += String.fromCharCode(b)
    }
    return s.trim()
  }

  const walkIfd = (relOffset: number, isExifSub: boolean): void => {
    const dirPos = tiffStart + relOffset
    if (relOffset <= 0 || dirPos + 2 > maxEnd) return
    const count = read16(dirPos)
    if (count > 256) return
    for (let i = 0; i < count; i++) {
      const entry = dirPos + 2 + i * 12
      if (entry + 12 > maxEnd) break
      const tag = read16(entry)
      const valCount = read32(entry + 4)
      if (!isExifSub) {
        if (tag === 0x010f) info.make = readAsciiTag(valCount, entry + 8)
        else if (tag === 0x0110) info.model = readAsciiTag(valCount, entry + 8)
        else if (tag === 0x0131) info.software = readAsciiTag(valCount, entry + 8)
        else if (tag === 0x8769) exifIfdRel = read32(entry + 8)
        else if (tag === 0x8825) info.hasGps = true
      } else {
        if (tag === 0x9003) info.dateTimeOriginal = readAsciiTag(valCount, entry + 8)
        else if (tag === 0x829a) info.hasExposure = true
        else if (tag === 0x829d) info.hasFNumber = true
        else if (tag === 0x8827) info.hasIso = true
        else if (tag === 0x920a) info.hasFocalLength = true
        else if (tag === 0xa434) info.hasLens = true
      }
    }
  }

  walkIfd(ifd0Rel, false)
  if (exifIfdRel > 0) {
    walkIfd(exifIfdRel, true)
  }
  return info
}

function evaluateExifInfo(
  exif: ExifInfo,
  findings: ForensicFinding[],
  metadata: KeyValueEntry[],
  textSources: string[]
): void {
  if (exif.make.length > 0) metadata.push({ key: 'exif_make', value: exif.make })
  if (exif.model.length > 0) metadata.push({ key: 'exif_model', value: exif.model })
  if (exif.software.length > 0) {
    metadata.push({ key: 'exif_software', value: exif.software })
    textSources.push(exif.software)
  }
  if (exif.dateTimeOriginal.length > 0) {
    metadata.push({ key: 'exif_date_original', value: exif.dateTimeOriginal })
  }

  let opticalCount = 0
  if (exif.hasExposure) opticalCount++
  if (exif.hasFNumber) opticalCount++
  if (exif.hasIso) opticalCount++
  if (exif.hasFocalLength) opticalCount++
  if (exif.hasLens) opticalCount++

  if (exif.make.length > 0 && isKnownCameraMake(exif.make) && opticalCount >= 2) {
    findings.push({
      id: 'img_authentic_camera_exif',
      category: 'provenance',
      severity: 'authentic',
      scoreDelta: -24,
      titleTr: `Gerçek kamera EXIF zinciri bulundu (${exif.make} ${exif.model})`,
      titleEn: `Authentic camera EXIF chain found (${exif.make} ${exif.model})`,
      detailTr: `Bilinen bir kamera üreticisi ve ${opticalCount} optik çekim parametresi (enstantane/diyafram/ISO/odak) mevcut.`,
      detailEn: `Known camera manufacturer with ${opticalCount} optical capture parameters (exposure/aperture/ISO/focal length).`,
      evidence: `${exif.make} ${exif.model} opticalTags=${opticalCount}${exif.hasGps ? ' +GPS' : ''}`
    })
  }
}

function analyzePng(
  buf: Uint8Array,
  findings: ForensicFinding[],
  metadata: KeyValueEntry[],
  metrics: KeyValueEntry[],
  textSources: string[]
): void {
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  let hasExif = false
  let hasCabx = false
  let hasTime = false
  const idatChunks: Uint8Array[] = []
  let offset = 8

  while (offset + 12 <= buf.length) {
    const length = readU32BE(buf, offset)
    const type = asciiAt(buf, offset + 4, 4)
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    if (dataEnd + 4 > buf.length) break

    if (type === 'IHDR' && length >= 13) {
      width = readU32BE(buf, dataStart)
      height = readU32BE(buf, dataStart + 4)
      bitDepth = buf[dataStart + 8]!
      colorType = buf[dataStart + 9]!
      interlace = buf[dataStart + 12]!
      metadata.push({ key: 'dimensions', value: `${width}x${height}` })
      metadata.push({ key: 'png_bit_depth', value: String(bitDepth) })
      metadata.push({ key: 'png_color_type', value: String(colorType) })
    } else if (type === 'IDAT') {
      idatChunks.push(buf.subarray(dataStart, dataEnd))
    } else if (type === 'tEXt') {
      let nul = dataStart
      while (nul < dataEnd && buf[nul] !== 0) nul++
      const key = asciiAt(buf, dataStart, nul - dataStart)
      const val = printableSlice(buf, nul + 1, dataEnd, 4096)
      if (key.length > 0) {
        metadata.push({ key: `png_text_${key}`, value: val.slice(0, 180) })
        textSources.push(`${key}: ${val}`)
      }
    } else if (type === 'zTXt') {
      let nul = dataStart
      while (nul < dataEnd && buf[nul] !== 0) nul++
      const key = asciiAt(buf, dataStart, nul - dataStart)
      if (nul + 2 < dataEnd) {
        try {
          const comp = buf.subarray(nul + 2, dataEnd)
          const inflated = Buffer.from(inflateZlib(comp, 1024 * 1024)).toString('utf8')
          metadata.push({ key: `png_ztxt_${key}`, value: inflated.slice(0, 180) })
          textSources.push(`${key}: ${inflated}`)
        } catch {
          // Ignore malformed zlib chunk
        }
      }
    } else if (type === 'iTXt') {
      let nul = dataStart
      while (nul < dataEnd && buf[nul] !== 0) nul++
      const key = asciiAt(buf, dataStart, nul - dataStart)
      if (nul + 3 < dataEnd) {
        const compFlag = buf[nul + 1]!
        let p = nul + 3
        // Skip language tag
        while (p < dataEnd && buf[p] !== 0) p++
        p++
        // Skip translated keyword
        while (p < dataEnd && buf[p] !== 0) p++
        p++
        if (p < dataEnd) {
          let val = ''
          if (compFlag === 1) {
            try {
              val = Buffer.from(inflateZlib(buf.subarray(p, dataEnd), 1024 * 1024)).toString('utf8')
            } catch {
              val = ''
            }
          } else {
            val = printableSlice(buf, p, dataEnd, 8192)
          }
          if (val.length > 0) {
            metadata.push({ key: `png_itxt_${key}`, value: val.slice(0, 180) })
            textSources.push(`${key}: ${val}`)
          }
        }
      }
    } else if (type === 'eXIf') {
      hasExif = true
      const exif = parseExifBlock(buf, dataStart, dataEnd)
      evaluateExifInfo(exif, findings, metadata, textSources)
    } else if (type === 'caBX') {
      hasCabx = true
      textSources.push(printableSlice(buf, dataStart, dataEnd, 16384))
    } else if (type === 'tIME') {
      hasTime = true
    } else if (type === 'IEND') {
      const trailing = buf.length - (dataEnd + 4)
      if (trailing > 32) {
        metrics.push({ key: 'png_trailing_bytes', value: String(trailing) })
      }
      break
    }

    offset = dataEnd + 4
  }

  if (hasCabx) {
    findings.push({
      id: 'png_cabx_c2pa',
      category: 'provenance',
      severity: 'low',
      scoreDelta: 8,
      titleTr: 'PNG caBX (C2PA Content Credentials) bloğu bulundu',
      titleEn: 'PNG caBX (C2PA Content Credentials) chunk present',
      detailTr: 'PNG dosyası C2PA kimlik bilgisi bloğu içeriyor.',
      detailEn: 'PNG file contains a C2PA Content Credentials chunk.',
      evidence: 'caBX chunk'
    })
  }

  if (width > 0 && height > 0) {
    checkImageDimensions(width, height, hasExif, hasTime, 'PNG', findings)
  }

  const decoded = decodePngPixels(width, height, bitDepth, colorType, interlace, idatChunks)
  if (decoded !== null) {
    analyzeDecodedPixels(decoded, findings, metrics)
  }
}

function analyzeJpeg(
  buf: Uint8Array,
  findings: ForensicFinding[],
  metadata: KeyValueEntry[],
  metrics: KeyValueEntry[],
  textSources: string[]
): void {
  let offset = 2
  let width = 0
  let height = 0
  let hasExif = false
  let hasIcc = false
  let hasApp11 = false
  let dqtCount = 0
  let dqtAvgFirst = 0
  let chromaSub = ''
  let eoiPos = -1

  while (offset + 4 <= buf.length) {
    if (buf[offset] !== 0xff) {
      offset++
      continue
    }
    while (offset < buf.length && buf[offset] === 0xff) offset++
    if (offset >= buf.length) break
    const marker = buf[offset++]!

    if (marker === 0xd9) {
      eoiPos = offset
      break
    }
    if (marker === 0xda) {
      // Start of Scan: find EOI from end
      for (let k = buf.length - 2; k >= offset; k--) {
        if (buf[k] === 0xff && buf[k + 1] === 0xd9) {
          eoiPos = k + 2
          break
        }
      }
      break
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue

    if (offset + 2 > buf.length) break
    const segLen = readU16BE(buf, offset)
    if (segLen < 2 || offset + segLen > buf.length) break
    const dataStart = offset + 2
    const dataEnd = offset + segLen

    if (marker === 0xc0 || marker === 0xc2) {
      // SOF0 / SOF2
      if (dataEnd - dataStart >= 9) {
        height = readU16BE(buf, dataStart + 1)
        width = readU16BE(buf, dataStart + 3)
        const comps = buf[dataStart + 5]!
        if (comps === 3 && dataEnd - dataStart >= 15) {
          const hvY = buf[dataStart + 7]!
          const hY = (hvY >> 4) & 0x0f
          const vY = hvY & 0x0f
          if (hY === 1 && vY === 1) chromaSub = '4:4:4'
          else if (hY === 2 && vY === 1) chromaSub = '4:2:2'
          else if (hY === 2 && vY === 2) chromaSub = '4:2:0'
          else chromaSub = `${hY}x${vY}`
        }
        metadata.push({ key: 'dimensions', value: `${width}x${height}` })
        if (chromaSub.length > 0) metadata.push({ key: 'jpeg_chroma', value: chromaSub })
      }
    } else if (marker === 0xe1) {
      // APP1: EXIF or XMP
      if (asciiAt(buf, dataStart, 6) === 'Exif\0\0') {
        hasExif = true
        const exif = parseExifBlock(buf, dataStart + 6, dataEnd)
        evaluateExifInfo(exif, findings, metadata, textSources)
      } else if (asciiAt(buf, dataStart, 29) === 'http://ns.adobe.com/xap/1.0/\0') {
        const xmp = printableSlice(buf, dataStart + 29, dataEnd, 16384)
        textSources.push(xmp)
        metadata.push({ key: 'jpeg_xmp', value: `present (${xmp.length} chars)` })
      }
    } else if (marker === 0xe2) {
      if (asciiAt(buf, dataStart, 11) === 'ICC_PROFILE') hasIcc = true
    } else if (marker === 0xeb) {
      // APP11 JUMBF / C2PA
      hasApp11 = true
      textSources.push(printableSlice(buf, dataStart, dataEnd, 16384))
    } else if (marker === 0xfe) {
      // COM comment
      const comment = printableSlice(buf, dataStart, dataEnd, 2048)
      if (comment.length > 0) {
        metadata.push({ key: 'jpeg_comment', value: comment.slice(0, 180) })
        textSources.push(comment)
      }
    } else if (marker === 0xdb) {
      // DQT Quantization table
      let p = dataStart
      while (p < dataEnd) {
        const pqTq = buf[p++]!
        const prec = (pqTq >> 4) & 0x0f
        const tableBytes = prec === 0 ? 64 : 128
        if (p + tableBytes > dataEnd) break
        if (dqtCount === 0 && prec === 0) {
          let sum = 0
          for (let q = 0; q < 64; q++) sum += buf[p + q]!
          dqtAvgFirst = sum / 64
        }
        dqtCount++
        p += tableBytes
      }
    }

    offset = dataEnd
  }

  metrics.push({ key: 'jpeg_dqt_tables', value: String(dqtCount) })
  if (dqtAvgFirst > 0) metrics.push({ key: 'jpeg_dqt_luma_mean', value: String(round2(dqtAvgFirst)) })
  metrics.push({ key: 'jpeg_has_exif', value: hasExif ? 'yes' : 'no' })
  metrics.push({ key: 'jpeg_has_icc', value: hasIcc ? 'yes' : 'no' })

  if (hasApp11) {
    findings.push({
      id: 'jpeg_app11_jumbf',
      category: 'provenance',
      severity: 'low',
      scoreDelta: 8,
      titleTr: 'JPEG APP11 (JUMBF / C2PA) segmenti mevcut',
      titleEn: 'JPEG APP11 (JUMBF / C2PA) segment present',
      detailTr: 'JPEG dosyası JUMBF/C2PA içerik kimliği segmenti barındırıyor.',
      detailEn: 'JPEG file carries a JUMBF/C2PA Content Credentials segment.',
      evidence: 'APP11 marker'
    })
  }

  if (eoiPos > 0 && buf.length - eoiPos > 64) {
    const trailing = buf.length - eoiPos
    metrics.push({ key: 'jpeg_trailing_bytes', value: String(trailing) })
    textSources.push(printableSlice(buf, eoiPos, buf.length, 8192))
  }

  if (width > 0 && height > 0) {
    checkImageDimensions(width, height, hasExif, false, 'JPEG', findings)
  }
}

function analyzeWebp(
  buf: Uint8Array,
  findings: ForensicFinding[],
  metadata: KeyValueEntry[],
  textSources: string[]
): void {
  let offset = 12
  let width = 0
  let height = 0
  let hasExif = false

  while (offset + 8 <= buf.length) {
    const fourcc = asciiAt(buf, offset, 4)
    const size = readU32LE(buf, offset + 4)
    const dataStart = offset + 8
    const dataEnd = Math.min(buf.length, dataStart + size)

    if (fourcc === 'VP8X' && size >= 10) {
      width = 1 + (buf[dataStart + 4]! | (buf[dataStart + 5]! << 8) | (buf[dataStart + 6]! << 16))
      height = 1 + (buf[dataStart + 7]! | (buf[dataStart + 8]! << 8) | (buf[dataStart + 9]! << 16))
      metadata.push({ key: 'dimensions', value: `${width}x${height}` })
    } else if (fourcc === 'VP8 ' && size >= 10 && width === 0) {
      if (buf[dataStart + 3] === 0x9d && buf[dataStart + 4] === 0x01 && buf[dataStart + 5] === 0x2a) {
        width = readU16LE(buf, dataStart + 6) & 0x3fff
        height = readU16LE(buf, dataStart + 8) & 0x3fff
        metadata.push({ key: 'dimensions', value: `${width}x${height}` })
      }
    } else if (fourcc === 'EXIF') {
      hasExif = true
      const exifOffset = asciiAt(buf, dataStart, 6) === 'Exif\0\0' ? dataStart + 6 : dataStart
      const exif = parseExifBlock(buf, exifOffset, dataEnd)
      evaluateExifInfo(exif, findings, metadata, textSources)
    } else if (fourcc === 'XMP ' || fourcc === 'C2PA') {
      textSources.push(printableSlice(buf, dataStart, dataEnd, 16384))
      metadata.push({ key: `webp_${fourcc.trim().toLowerCase()}`, value: `${size} bytes` })
    }

    offset = dataStart + size + (size & 1)
  }

  if (width > 0 && height > 0) {
    checkImageDimensions(width, height, hasExif, false, 'WEBP', findings)
  }
}

function checkImageDimensions(
  width: number,
  height: number,
  hasExif: boolean,
  hasTime: boolean,
  format: string,
  findings: ForensicFinding[]
): void {
  if (isCanonicalAiDimension(width, height)) {
    findings.push({
      id: 'img_canonical_ai_resolution',
      category: 'geometry',
      severity: 'medium',
      scoreDelta: hasExif ? 8 : 16,
      titleTr: `Tipik AI difüzyon çözünürlüğü (${width}x${height})`,
      titleEn: `Canonical AI diffusion resolution (${width}x${height})`,
      detailTr: `${width}x${height} çözünürlüğü SD/SDXL/Flux/DALL-E/Midjourney gibi difüzyon modellerinin standart çıktı boyutlarıyla birebir örtüşüyor.`,
      detailEn: `Resolution ${width}x${height} matches canonical output grids of diffusion models (SD/SDXL/Flux/DALL-E/Midjourney).`,
      evidence: `${width}x${height}, hasExif=${hasExif ? 'yes' : 'no'}`
    })
  } else if (width >= 512 && height >= 512 && width % 64 === 0 && height % 64 === 0 && !hasExif) {
    findings.push({
      id: 'img_latent_multiple64_no_exif',
      category: 'geometry',
      severity: 'low',
      scoreDelta: 10,
      titleTr: `EXIF bulunmayan 64'ün katı çözünürlük (${width}x${height})`,
      titleEn: `Multiple-of-64 resolution without EXIF (${width}x${height})`,
      detailTr: 'Latent difüzyon modelleri genellikle 64 piksel katlarında EXIF kaydı olmayan görseller üretir.',
      detailEn: 'Latent diffusion pipelines typically output multiples of 64 pixels without camera EXIF.',
      evidence: `${width}x${height}`
    })
  }

  if (!hasExif && !hasTime && (format === 'JPEG' || format === 'PNG') && width >= 512 && height >= 512) {
    findings.push({
      id: 'img_missing_camera_metadata',
      category: 'metadata',
      severity: 'low',
      scoreDelta: 7,
      titleTr: 'Kamera/çekim EXIF metaverisi bulunmuyor',
      titleEn: 'No camera capture EXIF metadata present',
      detailTr: 'Dosyada cihaz üreticisi, lens veya çekim parametreleri yer almıyor (AI çıktısı veya metaverisi silinmiş görsel olabilir).',
      detailEn: 'No camera make/model or optical EXIF tags found (typical of AI outputs or stripped web exports).',
      evidence: `${format} without EXIF`
    })
  }
}

export function analyzeImage(buf: Uint8Array, format: string): AnalyzerResult {
  const findings: ForensicFinding[] = []
  const metadata: KeyValueEntry[] = []
  const metrics: KeyValueEntry[] = []
  const generatorHints: string[] = []
  const textSources: string[] = []

  const entropy = shannonEntropy(buf)
  metrics.push({ key: 'file_shannon_entropy', value: String(round2(entropy)) })

  if (format === 'PNG') {
    analyzePng(buf, findings, metadata, metrics, textSources)
  } else if (format === 'JPEG') {
    analyzeJpeg(buf, findings, metadata, metrics, textSources)
  } else if (format === 'WEBP') {
    analyzeWebp(buf, findings, metadata, textSources)
  } else if (format === 'BMP') {
    const decoded = decodeBmpPixels(buf)
    if (decoded !== null) {
      metadata.push({ key: 'dimensions', value: `${decoded.width}x${decoded.height}` })
      checkImageDimensions(decoded.width, decoded.height, false, false, 'BMP', findings)
      analyzeDecodedPixels(decoded, findings, metrics)
    }
  } else if (format === 'GIF') {
    if (buf.length >= 10) {
      const w = readU16LE(buf, 6)
      const h = readU16LE(buf, 8)
      metadata.push({ key: 'dimensions', value: `${w}x${h}` })
      const xmpIdx = indexOfAscii(buf, 'XMP DataXMP')
      if (xmpIdx >= 0) {
        textSources.push(printableSlice(buf, xmpIdx, Math.min(buf.length, xmpIdx + 16384), 16384))
      }
    }
  }

  // Run C2PA/XMP binary scan + signature matcher
  const binScan = scanBinaryForC2paAndXmp(buf, 'image')
  for (let i = 0; i < binScan.findings.length; i++) findings.push(binScan.findings[i]!)
  for (let i = 0; i < binScan.generators.length; i++) addUnique(generatorHints, binScan.generators[i]!)

  const textScan = scanTextForAiSignatures(textSources, 'image')
  for (let i = 0; i < textScan.findings.length; i++) findings.push(textScan.findings[i]!)
  for (let i = 0; i < textScan.generators.length; i++) addUnique(generatorHints, textScan.generators[i]!)

  return {
    mediaCategory: 'image',
    detectedFormat: format,
    findings,
    metadata,
    metrics,
    generatorHints
  }
}
