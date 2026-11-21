import { Buffer } from 'node:buffer'
import { zlibWrapUncompressed } from './inflate.ts'
import type { AnalysisReport, OutputLang, Verdict } from './types.ts'
import { analyzeBuffer } from './analyzer.ts'
import { formatReportText } from './report.ts'

interface SelfTestCase {
  name: string
  filePath: string
  data: Uint8Array
  expectedVerdicts: Verdict[]
}

function writeU32BE(arr: Uint8Array, offset: number, value: number): void {
  arr[offset] = (value >>> 24) & 0xff
  arr[offset + 1] = (value >>> 16) & 0xff
  arr[offset + 2] = (value >>> 8) & 0xff
  arr[offset + 3] = value & 0xff
}

function writeU16BE(arr: Uint8Array, offset: number, value: number): void {
  arr[offset] = (value >>> 8) & 0xff
  arr[offset + 1] = value & 0xff
}

function writeU32LE(arr: Uint8Array, offset: number, value: number): void {
  arr[offset] = value & 0xff
  arr[offset + 1] = (value >>> 8) & 0xff
  arr[offset + 2] = (value >>> 16) & 0xff
  arr[offset + 3] = (value >>> 24) & 0xff
}

function writeU16LE(arr: Uint8Array, offset: number, value: number): void {
  arr[offset] = value & 0xff
  arr[offset + 1] = (value >>> 8) & 0xff
}

function writeAscii(arr: Uint8Array, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    arr[offset + i] = text.charCodeAt(i) & 0xff
  }
}

function makePngChunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length)
  writeU32BE(out, 0, data.length)
  writeAscii(out, 4, type)
  out.set(data, 8)
  // CRC placeholder (zero is fine for structural parser)
  return out
}

function buildAiTaggedPng(): Uint8Array {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const width = 64
  const height = 64
  const ihdr = Buffer.alloc(13)
  writeU32BE(ihdr, 0, width)
  writeU32BE(ihdr, 4, height)
  ihdr[8] = 8 // 8-bit
  ihdr[9] = 2 // RGB
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  // Synthetic smooth image with subtle 8px VAE grid periodicity
  const rawScanlines = Buffer.alloc(height * (1 + width * 3))
  let p = 0
  for (let y = 0; y < height; y++) {
    rawScanlines[p++] = 0
    for (let x = 0; x < width; x++) {
      const grid = (x % 8 === 0 || y % 8 === 0) ? 4 : 0
      const base = Math.floor(120 + 20 * Math.sin(x * 0.1) + grid)
      rawScanlines[p++] = base
      rawScanlines[p++] = base
      rawScanlines[p++] = base
    }
  }
  const idatData = zlibWrapUncompressed(rawScanlines)
  const textPayload = Buffer.from(
    'parameters\0studio product photo of smart watch, ultra clean\nSteps: 30, Sampler: DPM++ 2M Karras, CFG scale: 7, Seed: 4219921, Model: sdxl_base_1.0'
  )

  return Buffer.concat([
    sig,
    makePngChunk('IHDR', ihdr),
    makePngChunk('tEXt', textPayload),
    makePngChunk('IDAT', idatData),
    makePngChunk('IEND', Buffer.alloc(0))
  ])
}

function buildAuthenticCameraJpeg(): Uint8Array {
  // Build minimal valid JPEG with APP1 EXIF (Sony ILCE-7M4 + Exposure/FNumber/ISO/FocalLength) + SOF0 (4000x2667) + EOI
  const tiff = Buffer.alloc(160)
  writeAscii(tiff, 0, 'II')
  writeU16LE(tiff, 2, 42)
  writeU32LE(tiff, 4, 8) // IFD0 offset

  // IFD0: 3 entries (Make, Model, ExifIFD)
  writeU16LE(tiff, 8, 3)
  // Entry 0: Make (0x010F), ASCII (2), count 5, offset 60
  writeU16LE(tiff, 10, 0x010f)
  writeU16LE(tiff, 12, 2)
  writeU32LE(tiff, 14, 5)
  writeU32LE(tiff, 18, 60)
  // Entry 1: Model (0x0110), ASCII (2), count 9, offset 68
  writeU16LE(tiff, 22, 0x0110)
  writeU16LE(tiff, 24, 2)
  writeU32LE(tiff, 26, 9)
  writeU32LE(tiff, 30, 68)
  // Entry 2: ExifIFD (0x8769), LONG (4), count 1, offset 84
  writeU16LE(tiff, 34, 0x8769)
  writeU16LE(tiff, 36, 4)
  writeU32LE(tiff, 38, 1)
  writeU32LE(tiff, 42, 84)
  writeU32LE(tiff, 46, 0)

  writeAscii(tiff, 60, 'SONY\0')
  writeAscii(tiff, 68, 'ILCE-7M4\0')

  // ExifIFD at 84: 4 optical tags (ExposureTime, FNumber, ISO, FocalLength)
  writeU16LE(tiff, 84, 4)
  writeU16LE(tiff, 86, 0x829a)
  writeU16LE(tiff, 88, 5)
  writeU32LE(tiff, 90, 1)
  writeU32LE(tiff, 94, 0)

  writeU16LE(tiff, 98, 0x829d)
  writeU16LE(tiff, 100, 5)
  writeU32LE(tiff, 102, 1)
  writeU32LE(tiff, 106, 0)

  writeU16LE(tiff, 110, 0x8827)
  writeU16LE(tiff, 112, 3)
  writeU32LE(tiff, 114, 1)
  writeU32LE(tiff, 118, 400)

  writeU16LE(tiff, 122, 0x920a)
  writeU16LE(tiff, 124, 5)
  writeU32LE(tiff, 126, 1)
  writeU32LE(tiff, 130, 0)

  const app1Payload = Buffer.concat([Buffer.from('Exif\0\0'), tiff])
  const app1 = Buffer.alloc(4 + app1Payload.length)
  app1[0] = 0xff
  app1[1] = 0xe1
  writeU16BE(app1, 2, app1Payload.length + 2)
  app1.set(app1Payload, 4)

  const sof0 = Buffer.alloc(19)
  sof0[0] = 0xff
  sof0[1] = 0xc0
  writeU16BE(sof0, 2, 17)
  sof0[4] = 8
  writeU16BE(sof0, 5, 2667)
  writeU16BE(sof0, 7, 4000)
  sof0[9] = 3
  sof0[10] = 1
  sof0[11] = 0x22
  sof0[12] = 0

  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, sof0, Buffer.from([0xff, 0xd9])])
}

function buildWav(sampleRate: number, samples: Float64Array, extraChunks: Buffer[]): Uint8Array {
  const dataBytes = samples.length * 2
  const fmt = Buffer.alloc(24)
  writeAscii(fmt, 0, 'fmt ')
  writeU32LE(fmt, 4, 16)
  writeU16LE(fmt, 8, 1) // PCM
  writeU16LE(fmt, 10, 1) // mono
  writeU32LE(fmt, 12, sampleRate)
  writeU32LE(fmt, 16, sampleRate * 2)
  writeU16LE(fmt, 20, 2)
  writeU16LE(fmt, 22, 16)

  const dataChunk = Buffer.alloc(8 + dataBytes)
  writeAscii(dataChunk, 0, 'data')
  writeU32LE(dataChunk, 4, dataBytes)
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]!))
    const intVal = Math.round(clamped * 32767)
    const u = intVal < 0 ? intVal + 65536 : intVal
    writeU16LE(dataChunk, 8 + i * 2, u)
  }

  const body = Buffer.concat([fmt, ...extraChunks, dataChunk])
  const riff = Buffer.alloc(12)
  writeAscii(riff, 0, 'RIFF')
  writeU32LE(riff, 4, 4 + body.length)
  writeAscii(riff, 8, 'WAVE')
  return Buffer.concat([riff, body])
}

function buildAiVocoderWav(): Uint8Array {
  // 44.1 kHz container, speech-like bandlimited signal <= 7 kHz (sharp 8 kHz brickwall!) + digital-zero pauses
  const sr = 44100
  const n = sr * 2 // 2 seconds
  const samples = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / sr
    // Pause between 0.7s and 1.1s with exact digital zero (no room tone!)
    if (t >= 0.7 && t < 1.1) {
      samples[i] = 0
      continue
    }
    let val = 0
    for (let f = 350; f <= 6800; f += 650) {
      val += 0.06 * Math.sin(2 * Math.PI * f * t)
    }
    samples[i] = val
  }
  return buildWav(sr, samples, [])
}

function buildAuthenticMicWav(): Uint8Array {
  // 44.1 kHz natural recording with continuous room tone (-48 dBFS) + broadband harmonics + BEXT header
  const sr = 44100
  const n = sr * 2
  const samples = new Float64Array(n)
  let seed = 133791
  const nextNoise = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return (seed / 2147483648) - 1
  }

  for (let i = 0; i < n; i++) {
    const t = i / sr
    const roomTone = 0.004 * nextNoise() // ~ -48 dBFS natural room noise
    if (t >= 0.7 && t < 1.1) {
      samples[i] = roomTone
      continue
    }
    let val = roomTone
    // Broadband energy across low, mid, and high frequencies (no brickwall!)
    for (let f = 400; f <= 16500; f += 1300) {
      val += 0.03 * Math.sin(2 * Math.PI * f * t)
    }
    samples[i] = val + 0.015 * nextNoise()
  }

  const bext = Buffer.alloc(8 + 64)
  writeAscii(bext, 0, 'bext')
  writeU32LE(bext, 4, 64)
  writeAscii(bext, 8, 'Zoom F6 Field Recorder 24bit')
  return buildWav(sr, samples, [bext])
}

function makeMp4Box(type: string, payload: Buffer): Buffer {
  const out = Buffer.alloc(8 + payload.length)
  writeU32BE(out, 0, out.length)
  writeAscii(out, 4, type)
  out.set(payload, 8)
  return out
}

function buildAiSyntheticMp4(): Uint8Array {
  // Silent 49-frame 1280x768 MP4 with mvhd creation_time=0, Lavf encoder, uniform stsz
  const ftyp = makeMp4Box('ftyp', Buffer.from('isom\x00\x00\x02\x00isommp41'))

  const mvhdPayload = Buffer.alloc(100)
  writeU32BE(mvhdPayload, 4, 0) // creation_time = 0 (1904 epoch)
  writeU32BE(mvhdPayload, 12, 1000) // timescale
  writeU32BE(mvhdPayload, 16, 3062) // ~3.06s

  const tkhdPayload = Buffer.alloc(84)
  writeU32BE(tkhdPayload, 76, 1280 << 16)
  writeU32BE(tkhdPayload, 80, 768 << 16)

  const mdhdPayload = Buffer.alloc(24)
  writeU32BE(mdhdPayload, 12, 16000)
  writeU32BE(mdhdPayload, 16, 49000)

  const hdlrPayload = Buffer.alloc(24)
  writeAscii(hdlrPayload, 8, 'vide')

  const sttsPayload = Buffer.alloc(16)
  writeU32BE(sttsPayload, 4, 1) // 1 entry
  writeU32BE(sttsPayload, 8, 49) // 49 frames (4k+1 temporal VAE)
  writeU32BE(sttsPayload, 12, 1000) // 16 fps exact

  const stszPayload = Buffer.alloc(12 + 49 * 4)
  writeU32BE(stszPayload, 8, 49)
  for (let i = 0; i < 49; i++) {
    writeU32BE(stszPayload, 12 + i * 4, 12000 + (i % 4) * 200)
  }

  const stbl = makeMp4Box('stbl', Buffer.concat([makeMp4Box('stts', sttsPayload), makeMp4Box('stsz', stszPayload)]))
  const minf = makeMp4Box('minf', stbl)
  const mdia = makeMp4Box('mdia', Buffer.concat([makeMp4Box('mdhd', mdhdPayload), makeMp4Box('hdlr', hdlrPayload), minf]))
  const trak = makeMp4Box('trak', Buffer.concat([makeMp4Box('tkhd', tkhdPayload), mdia]))

  const encData = Buffer.concat([Buffer.from('data\x00\x00\x00\x01\x00\x00\x00\x00'), Buffer.from('Lavf60.16.100')])
  const tooBox = makeMp4Box('\xa9too', encData)
  const ilst = makeMp4Box('ilst', tooBox)
  const meta = makeMp4Box('meta', Buffer.concat([Buffer.alloc(4), ilst]))
  const udta = makeMp4Box('udta', meta)

  const moov = makeMp4Box('moov', Buffer.concat([makeMp4Box('mvhd', mvhdPayload), trak, udta]))
  const mdat = makeMp4Box('mdat', Buffer.alloc(128))
  return Buffer.concat([ftyp, moov, mdat])
}

function buildAuthenticPhoneMov(): Uint8Array {
  const ftyp = makeMp4Box('ftyp', Buffer.from('qt  \x00\x00\x00\x00qt  '))
  const mvhdPayload = Buffer.alloc(100)
  writeU32BE(mvhdPayload, 4, 3810000000) // Valid ~2024 UTC timestamp
  writeU32BE(mvhdPayload, 12, 600)
  writeU32BE(mvhdPayload, 16, 12000) // 20s

  const vTkhd = Buffer.alloc(84)
  writeU32BE(vTkhd, 76, 1920 << 16)
  writeU32BE(vTkhd, 80, 1080 << 16)
  const vHdlr = Buffer.alloc(24)
  writeAscii(vHdlr, 8, 'vide')
  const vTrak = makeMp4Box('trak', Buffer.concat([makeMp4Box('tkhd', vTkhd), makeMp4Box('mdia', makeMp4Box('hdlr', vHdlr))]))

  const aHdlr = Buffer.alloc(24)
  writeAscii(aHdlr, 8, 'soun')
  const aTrak = makeMp4Box('trak', makeMp4Box('mdia', makeMp4Box('hdlr', aHdlr)))

  const makBox = makeMp4Box('\xa9mak', Buffer.from('Apple'))
  const modBox = makeMp4Box('\xa9mod', Buffer.from('iPhone 15 Pro'))
  const udta = makeMp4Box('udta', Buffer.concat([makBox, modBox]))

  const moov = makeMp4Box('moov', Buffer.concat([makeMp4Box('mvhd', mvhdPayload), vTrak, aTrak, udta]))
  const mdat = makeMp4Box('mdat', Buffer.alloc(128))
  return Buffer.concat([ftyp, moov, mdat])
}

function buildAiProductCopyTr(): Uint8Array {
  const copy = [
    'Günümüzün hızla değişen yaşam temposunda benzersiz bir deneyim sunan bu akıllı saat hayatınızı kolaylaştıracak.',
    'Yenilikçi tasarımıyla ön plana çıkmaktadır ve üst düzey performans ile mükemmel bir denge kurarak bir adım öne çıkar.',
    '- **Üstün Batarya:** Tek şarjla uzun süre kesintisiz kullanım sağlar.',
    '- **Akıllı Sensörler:** Sağlık verilerinizi kusursuz bir şekilde takip eder.',
    '- **Şık Tasarım:** Her ortamda vazgeçilmez bir aksesuar olarak dikkat çeker.',
    'Bununla birlikte öte yandan unutulmamalıdır ki sonuç olarak bu ürün günlük rutininizde dikkat çekici bir fark yaratır.'
  ].join('\n\n')
  return Buffer.from(copy, 'utf8')
}

function buildAiTypeScriptCode(): Uint8Array {
  const src = [
    '/**',
    ' * Safely fetches user orders — clean and modular helper 🚀',
    ' * @param apiKey The API key',
    ' * @param userId The user identifier',
    ' * @returns Normalized order list',
    ' */',
    'export async function fetchOrders(apiKey: string, userId: string): Promise<string[]> {',
    '  // Step 1: Validate input parameters',
    '  if (!userId) return []',
    '  // Step 2: Initialize the request headers',
    '  const token = apiKey || "YOUR_API_KEY"',
    '  // Step 3: Handle the API request — fallback safely ✅',
    '  const url = `https://api.example.com/orders/${userId}`',
    '  // ... existing code ...',
    '  // Return the final result',
    '  return [token, url]',
    '}'
  ].join('\n')
  return Buffer.from(src, 'utf8')
}

function buildAiPythonCode(): Uint8Array {
  const src = [
    '# Generated by Claude',
    'def compute_discount(price: float, rate: float) -> float:',
    '    """',
    '    Calculate the discounted price.',
    '    Args:',
    '        price: Original amount',
    '        rate: Discount percentage',
    '    Returns:',
    '        Final price after discount',
    '    """',
    '    # Step 1: Validate the input values',
    '    if price <= 0:',
    '        return 0.0',
    '    # Step 2: Calculate the final value',
    '    return round(price * (1.0 - rate), 2)',
    '',
    '# Example usage',
    'print(compute_discount(100.0, 0.15))'
  ].join('\n')
  return Buffer.from(src, 'utf8')
}

function buildAuthenticHumanTsCode(): Uint8Array {
  const src = [
    '// FIXME: ring buffer wraps awkwardly on 0-byte reads (#418)',
    'export class RingQueue {',
    '  private buf: Int32Array',
    '  private head = 0',
    '  private tail = 0',
    '  private count = 0',
    '  constructor(cap: number) {',
    '    this.buf = new Int32Array(cap)',
    '  }',
    '  push(v: number): boolean {',
    '    if (this.count === this.buf.length) return false',
    '    this.buf[this.tail] = v',
    '    this.tail = (this.tail + 1) % this.buf.length',
    '    this.count++',
    '    return true',
    '  }',
    '  pop(): number {',
    '    if (this.count === 0) return -1',
    '    // @ts-expect-error index guaranteed in bounds by count check',
    '    const v: number = this.buf[this.head]',
    '    this.head = (this.head + 1) % this.buf.length',
    '    this.count--',
    '    return v',
    '  }',
    '}'
  ].join('\n')
  return Buffer.from(src, 'utf8')
}

export function runSelfTests(lang: OutputLang, verbose: boolean, useColor: boolean): number {
  const cases: SelfTestCase[] = [
    {
      name: 'AI Stable Diffusion PNG (metadata + 8px grid)',
      filePath: 'selftest_sdxl_product.png',
      data: buildAiTaggedPng(),
      expectedVerdicts: ['CONFIRMED_AI']
    },
    {
      name: 'Authentic Sony Camera JPEG (EXIF + optical tags)',
      filePath: 'selftest_sony_camera.jpg',
      data: buildAuthenticCameraJpeg(),
      expectedVerdicts: ['LIKELY_AUTHENTIC']
    },
    {
      name: 'AI Neural Vocoder WAV (8 kHz brickwall + digital silence)',
      filePath: 'selftest_ai_voice.wav',
      data: buildAiVocoderWav(),
      expectedVerdicts: ['LIKELY_AI', 'CONFIRMED_AI']
    },
    {
      name: 'Authentic Microphone WAV (room tone + broadband + BEXT)',
      filePath: 'selftest_real_mic.wav',
      data: buildAuthenticMicWav(),
      expectedVerdicts: ['LIKELY_AUTHENTIC']
    },
    {
      name: 'AI Synthetic Video MP4 (49 frames + silent + epoch 0 + Lavf)',
      filePath: 'selftest_ai_video.mp4',
      data: buildAiSyntheticMp4(),
      expectedVerdicts: ['LIKELY_AI', 'CONFIRMED_AI']
    },
    {
      name: 'Authentic Smartphone MOV (audio + timestamp + Apple tags)',
      filePath: 'selftest_iphone_clip.mov',
      data: buildAuthenticPhoneMov(),
      expectedVerdicts: ['LIKELY_AUTHENTIC']
    },
    {
      name: 'AI Product Description Copy (Turkish LLM stylometry)',
      filePath: 'selftest_ai_product_copy.md',
      data: buildAiProductCopyTr(),
      expectedVerdicts: ['LIKELY_AI', 'CONFIRMED_AI']
    },
    {
      name: 'AI-Generated TypeScript Code (step narration + omission + typography)',
      filePath: 'selftest_ai_service.ts',
      data: buildAiTypeScriptCode(),
      expectedVerdicts: ['LIKELY_AI', 'CONFIRMED_AI']
    },
    {
      name: 'AI-Generated Python Code (explicit Claude attribution + docblocks)',
      filePath: 'selftest_ai_pricing.py',
      data: buildAiPythonCode(),
      expectedVerdicts: ['CONFIRMED_AI']
    },
    {
      name: 'Authentic Human TypeScript Code (concise + FIXME/#418 + @ts-expect-error)',
      filePath: 'selftest_human_ring.ts',
      data: buildAuthenticHumanTsCode(),
      expectedVerdicts: ['LIKELY_AUTHENTIC']
    }
  ]

  let passed = 0
  for (let i = 0; i < cases.length; i++) {
    const tc = cases[i]!
    const report: AnalysisReport = analyzeBuffer(tc.data, tc.filePath, 60)
    let ok = false
    for (let j = 0; j < tc.expectedVerdicts.length; j++) {
      if (tc.expectedVerdicts[j] === report.verdict) ok = true
    }
    if (ok) passed++
    const status = ok ? 'PASS' : 'FAIL'
    console.log(`[${status}] ${tc.name} -> verdict=${report.verdict} score=${report.aiScore}/100 (${report.elapsedMs} ms)`)
    if (verbose || !ok) {
      console.log(formatReportText(report, lang, verbose, useColor))
    }
  }

  console.log(`\nSelf-test summary: ${passed}/${cases.length} passed.`)
  return passed === cases.length ? 0 : 1
}
