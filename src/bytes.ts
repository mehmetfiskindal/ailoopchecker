import type { MediaCategory } from './types.ts'

export interface MagicDetection {
  category: MediaCategory
  format: string
}

export function readU16BE(buf: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > buf.length) return 0
  return ((buf[offset]! << 8) | buf[offset + 1]!) >>> 0
}

export function readU16LE(buf: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > buf.length) return 0
  return (buf[offset]! | (buf[offset + 1]! << 8)) >>> 0
}

export function readI16LE(buf: Uint8Array, offset: number): number {
  const u = readU16LE(buf, offset)
  return u >= 0x8000 ? u - 0x10000 : u
}

export function readU32BE(buf: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > buf.length) return 0
  return (
    ((buf[offset]! << 24) |
      (buf[offset + 1]! << 16) |
      (buf[offset + 2]! << 8) |
      buf[offset + 3]!) >>>
    0
  )
}

export function readU32LE(buf: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > buf.length) return 0
  return (
    (buf[offset]! |
      (buf[offset + 1]! << 8) |
      (buf[offset + 2]! << 16) |
      (buf[offset + 3]! << 24)) >>>
    0
  )
}

export function readI32LE(buf: Uint8Array, offset: number): number {
  const u = readU32LE(buf, offset)
  return u >= 0x80000000 ? u - 0x100000000 : u
}

export function readU64BE(buf: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 8 > buf.length) return 0
  const hi = readU32BE(buf, offset)
  const lo = readU32BE(buf, offset + 4)
  return hi * 4294967296 + lo
}

export function readF32LE(buf: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > buf.length) return 0
  const bits = readU32LE(buf, offset)
  const sign = (bits >>> 31) !== 0 ? -1 : 1
  const exp = (bits >>> 23) & 0xff
  const frac = bits & 0x7fffff
  if (exp === 0) {
    if (frac === 0) return 0
    return sign * Math.pow(2, -126) * (frac / 8388608)
  }
  if (exp === 255) return 0
  return sign * Math.pow(2, exp - 127) * (1 + frac / 8388608)
}

export function asciiAt(buf: Uint8Array, offset: number, length: number): string {
  const end = Math.min(buf.length, offset + length)
  let out = ''
  for (let i = Math.max(0, offset); i < end; i++) {
    out += String.fromCharCode(buf[i]!)
  }
  return out
}

export function printableSlice(buf: Uint8Array, start: number, end: number, maxLen: number = 4096): string {
  const safeStart = Math.max(0, start)
  const safeEnd = Math.min(buf.length, end, safeStart + maxLen)
  let out = ''
  for (let i = safeStart; i < safeEnd; i++) {
    const b = buf[i]!
    if (b === 9 || b === 10 || b === 13 || (b >= 32 && b <= 126)) {
      out += String.fromCharCode(b)
    } else if (b >= 160) {
      out += String.fromCharCode(b)
    }
  }
  return out
}

export function extractAsciiRuns(buf: Uint8Array, minLen: number, maxBytes: number): string[] {
  const runs: string[] = []
  const limit = Math.min(buf.length, maxBytes)
  let current = ''
  for (let i = 0; i < limit; i++) {
    const b = buf[i]!
    if ((b >= 32 && b <= 126) || b === 9 || b === 10) {
      current += String.fromCharCode(b)
      if (current.length >= 2048) {
        runs.push(current)
        current = ''
      }
    } else {
      if (current.length >= minLen) {
        runs.push(current)
      }
      current = ''
    }
  }
  if (current.length >= minLen) {
    runs.push(current)
  }
  return runs
}

export function indexOfBytes(haystack: Uint8Array, needle: Uint8Array, fromIndex: number = 0): number {
  const nLen = needle.length
  if (nLen === 0) return fromIndex
  const limit = haystack.length - nLen
  const first = needle[0]!
  for (let i = Math.max(0, fromIndex); i <= limit; i++) {
    if (haystack[i] !== first) continue
    let ok = true
    for (let j = 1; j < nLen; j++) {
      if (haystack[i + j] !== needle[j]) {
        ok = false
        break
      }
    }
    if (ok) return i
  }
  return -1
}

export function indexOfAscii(buf: Uint8Array, text: string, fromIndex: number = 0): number {
  const needle = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) {
    needle[i] = text.charCodeAt(i) & 0xff
  }
  return indexOfBytes(buf, needle, fromIndex)
}

export function shannonEntropy(buf: Uint8Array, start: number = 0, length: number = -1): number {
  const s = Math.max(0, start)
  const end = length < 0 ? buf.length : Math.min(buf.length, s + length)
  const total = end - s
  if (total <= 0) return 0
  const counts = new Int32Array(256)
  // Sample large buffers deterministically for O(1) speed
  const step = total > 262144 ? Math.floor(total / 262144) : 1
  let sampled = 0
  for (let i = s; i < end; i += step) {
    const idx = buf[i]!
    counts[idx] = counts[idx]! + 1
    sampled++
  }
  if (sampled === 0) return 0
  let entropy = 0
  const invLog2 = 1 / Math.LN2
  for (let i = 0; i < 256; i++) {
    const c = counts[i]!
    if (c === 0) continue
    const p = c / sampled
    entropy -= p * Math.log(p) * invLog2
  }
  return entropy
}

export function round2(v: number): number {
  return Math.round(v * 100) / 100
}

export function clamp(v: number, min: number, max: number): number {
  if (v < min) return min
  if (v > max) return max
  return v
}

export function isLikelyUtf8Text(buf: Uint8Array): boolean {
  const limit = Math.min(buf.length, 4096)
  if (limit === 0) return false
  let controlBytes = 0
  for (let i = 0; i < limit; i++) {
    const b = buf[i]!
    if (b === 0) return false
    if (b < 32 && b !== 9 && b !== 10 && b !== 13) {
      controlBytes++
    }
  }
  return controlBytes / limit < 0.02
}

export function detectMagicFormat(buf: Uint8Array, fileExtLower: string): MagicDetection {
  if (buf.length >= 8) {
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47 &&
      buf[4] === 0x0d &&
      buf[5] === 0x0a &&
      buf[6] === 0x1a &&
      buf[7] === 0x0a
    ) {
      return { category: 'image', format: 'PNG' }
    }
  }

  // JPEG: FF D8 FF
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { category: 'image', format: 'JPEG' }
  }

  // GIF: GIF87a / GIF89a
  if (buf.length >= 6) {
    const g = asciiAt(buf, 0, 6)
    if (g === 'GIF87a' || g === 'GIF89a') {
      return { category: 'image', format: 'GIF' }
    }
  }

  // BMP: BM
  if (buf.length >= 14 && buf[0] === 0x42 && buf[1] === 0x4d) {
    const declaredSize = readU32LE(buf, 2)
    if (declaredSize > 0 && declaredSize <= buf.length + 1024) {
      return { category: 'image', format: 'BMP' }
    }
  }

  // TIFF: II*\0 or MM\0*
  if (
    buf.length >= 4 &&
    ((buf[0] === 0x49 && buf[1] === 0x49 && buf[2] === 0x2a && buf[3] === 0x00) ||
      (buf[0] === 0x4d && buf[1] === 0x4d && buf[2] === 0x00 && buf[3] === 0x2a))
  ) {
    return { category: 'image', format: 'TIFF' }
  }

  // RIFF containers: WEBP, WAVE, AVI
  if (buf.length >= 12 && asciiAt(buf, 0, 4) === 'RIFF') {
    const riffType = asciiAt(buf, 8, 4)
    if (riffType === 'WEBP') return { category: 'image', format: 'WEBP' }
    if (riffType === 'WAVE') return { category: 'audio', format: 'WAV' }
    if (riffType === 'AVI ') return { category: 'video', format: 'AVI' }
  }

  // ISO Base Media (MP4, MOV, M4A, AVIF, HEIC)
  if (buf.length >= 12 && asciiAt(buf, 4, 4) === 'ftyp') {
    const majorBrand = asciiAt(buf, 8, 4)
    if (majorBrand === 'avif' || majorBrand === 'avis' || majorBrand === 'heic' || majorBrand === 'heix' || majorBrand === 'mif1') {
      return { category: 'image', format: majorBrand.toUpperCase() }
    }
    if (majorBrand === 'M4A ' || majorBrand === 'M4B ' || fileExtLower === '.m4a') {
      return { category: 'audio', format: 'M4A' }
    }
    if (majorBrand === 'qt  ' || fileExtLower === '.mov') {
      return { category: 'video', format: 'MOV' }
    }
    return { category: 'video', format: 'MP4' }
  }

  // Matroska / WebM EBML: 1A 45 DF A3
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    if (indexOfAscii(buf.subarray(0, Math.min(buf.length, 64)), 'webm') >= 0 || fileExtLower === '.webm') {
      return { category: 'video', format: 'WEBM' }
    }
    return { category: 'video', format: 'MKV' }
  }

  // FLAC: fLaC
  if (buf.length >= 4 && asciiAt(buf, 0, 4) === 'fLaC') {
    return { category: 'audio', format: 'FLAC' }
  }

  // OGG / Opus: OggS
  if (buf.length >= 4 && asciiAt(buf, 0, 4) === 'OggS') {
    const head = buf.subarray(0, Math.min(buf.length, 64))
    if (indexOfAscii(head, 'OpusHead') >= 0) {
      return { category: 'audio', format: 'OPUS' }
    }
    return { category: 'audio', format: 'OGG' }
  }

  // MP3: ID3 tag or MPEG Audio Frame Sync (FF FB / FF F3 / FF F2 / FF FA)
  if (buf.length >= 3 && asciiAt(buf, 0, 3) === 'ID3') {
    return { category: 'audio', format: 'MP3' }
  }
  if (buf.length >= 2 && buf[0] === 0xff && (buf[1]! & 0xe0) === 0xe0 && (buf[1]! & 0x06) !== 0) {
    return { category: 'audio', format: 'MP3' }
  }

  // Source code languages (modern JS/TS, Python, Rust, Go, Swift, Kotlin, Java, C#, C/C++, Zig, etc.)
  const codeFormat = detectCodeFormat(buf, fileExtLower)
  if (codeFormat.length > 0) {
    return { category: 'code', format: codeFormat }
  }

  // Extension fallback for text/documents
  if (
    fileExtLower === '.txt' ||
    fileExtLower === '.md' ||
    fileExtLower === '.markdown' ||
    fileExtLower === '.html' ||
    fileExtLower === '.htm' ||
    fileExtLower === '.json' ||
    fileExtLower === '.csv' ||
    fileExtLower === '.xml' ||
    isLikelyUtf8Text(buf)
  ) {
    return { category: 'text', format: fileExtLower.length > 1 ? fileExtLower.slice(1).toUpperCase() : 'TEXT' }
  }

  return { category: 'unknown', format: 'BINARY' }
}

function detectCodeFormat(buf: Uint8Array, ext: string): string {
  if (ext === '.ts' || ext === '.mts' || ext === '.cts' || ext === '.tsx') return 'TYPESCRIPT'
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs' || ext === '.jsx') return 'JAVASCRIPT'
  if (ext === '.py' || ext === '.pyi') return 'PYTHON'
  if (ext === '.rs') return 'RUST'
  if (ext === '.go') return 'GO'
  if (ext === '.swift') return 'SWIFT'
  if (ext === '.kt' || ext === '.kts') return 'KOTLIN'
  if (ext === '.java') return 'JAVA'
  if (ext === '.cs') return 'CSHARP'
  if (ext === '.cpp' || ext === '.cc' || ext === '.cxx' || ext === '.hpp' || ext === '.hh') return 'CPP'
  if (ext === '.c' || ext === '.h') return 'C'
  if (ext === '.zig') return 'ZIG'
  if (ext === '.mojo') return 'MOJO'
  if (ext === '.gleam') return 'GLEAM'
  if (ext === '.ex' || ext === '.exs') return 'ELIXIR'
  if (ext === '.rb') return 'RUBY'
  if (ext === '.php') return 'PHP'
  if (ext === '.dart') return 'DART'
  if (ext === '.scala') return 'SCALA'
  if (ext === '.sql') return 'SQL'
  if (ext === '.sh' || ext === '.bash' || ext === '.zsh') return 'SHELL'

  // Shebang detection for extensionless scripts
  if (buf.length >= 10 && buf[0] === 0x23 && buf[1] === 0x21) {
    const firstLine = printableSlice(buf, 0, Math.min(buf.length, 128), 128).split('\n')[0] ?? ''
    const lower = firstLine.toLowerCase()
    if (lower.indexOf('python') >= 0) return 'PYTHON'
    if (lower.indexOf('node') >= 0 || lower.indexOf('bun') >= 0 || lower.indexOf('deno') >= 0 || lower.indexOf('tsx') >= 0) {
      return 'JAVASCRIPT'
    }
    if (lower.indexOf('ruby') >= 0) return 'RUBY'
    if (lower.indexOf('php') >= 0) return 'PHP'
    if (lower.indexOf('bash') >= 0 || lower.indexOf('/sh') >= 0 || lower.indexOf('zsh') >= 0) return 'SHELL'
  }
  return ''
}
