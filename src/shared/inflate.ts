// Pure TypeScript RFC 1950 / RFC 1951 zlib inflate (and stored-block zlib wrap for self-tests).
// Compiles cleanly to native C++ with geatsc with zero external zlib/brotli linkage.

class BitReader {
  private buf: Uint8Array
  private bytePos: number
  private bitBuf: number
  private bitCount: number

  constructor(buf: Uint8Array, startOffset: number) {
    this.buf = buf
    this.bytePos = startOffset
    this.bitBuf = 0
    this.bitCount = 0
  }

  readBits(n: number): number {
    while (this.bitCount < n) {
      if (this.bytePos >= this.buf.length) {
        throw new Error('Unexpected end of deflate stream')
      }
      this.bitBuf |= this.buf[this.bytePos++]! << this.bitCount
      this.bitCount += 8
    }
    const val = this.bitBuf & ((1 << n) - 1)
    this.bitBuf >>>= n
    this.bitCount -= n
    return val
  }

  alignToByte(): void {
    const drop = this.bitCount & 7
    if (drop > 0) {
      this.bitBuf >>>= drop
      this.bitCount -= drop
    }
  }

  readByteAligned(): number {
    if (this.bitCount >= 8) {
      const v = this.bitBuf & 0xff
      this.bitBuf >>>= 8
      this.bitCount -= 8
      return v
    }
    if (this.bytePos >= this.buf.length) {
      throw new Error('Unexpected end of deflate stream')
    }
    return this.buf[this.bytePos++]!
  }
}

interface HuffmanTable {
  counts: Int32Array
  symbols: Int32Array
  maxBits: number
}

function buildHuffman(lengths: Int32Array, count: number): HuffmanTable {
  const counts = new Int32Array(16)
  let maxBits = 0
  for (let i = 0; i < count; i++) {
    const len = lengths[i]!
    if (len > 0 && len <= 15) {
      counts[len] = counts[len]! + 1
      if (len > maxBits) maxBits = len
    }
  }

  const offsets = new Int32Array(16)
  let sum = 0
  for (let bits = 1; bits <= 15; bits++) {
    offsets[bits] = sum
    sum += counts[bits]!
  }

  const symbols = new Int32Array(sum)
  for (let sym = 0; sym < count; sym++) {
    const len = lengths[sym]!
    if (len > 0 && len <= 15) {
      const idx = offsets[len]!
      symbols[idx] = sym
      offsets[len] = idx + 1
    }
  }

  return { counts, symbols, maxBits }
}

function decodeSymbol(br: BitReader, table: HuffmanTable): number {
  let code = 0
  let first = 0
  let index = 0
  for (let len = 1; len <= table.maxBits; len++) {
    code |= br.readBits(1)
    const count = table.counts[len]!
    if (code - count < first) {
      return table.symbols[index + (code - first)]!
    }
    index += count
    first = (first + count) << 1
    code <<= 1
  }
  throw new Error('Invalid Huffman code in deflate stream')
}

const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
  163, 195, 227, 258
]
const LENGTH_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0
]
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049,
  3073, 4097, 6145, 8193, 12289, 16385, 24577
]
const DIST_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13
]
const CODE_LEN_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]

function buildFixedLitLenTable(): HuffmanTable {
  const lens = new Int32Array(288)
  for (let i = 0; i <= 143; i++) lens[i] = 8
  for (let i = 144; i <= 255; i++) lens[i] = 9
  for (let i = 256; i <= 279; i++) lens[i] = 7
  for (let i = 280; i <= 287; i++) lens[i] = 8
  return buildHuffman(lens, 288)
}

function buildFixedDistTable(): HuffmanTable {
  const lens = new Int32Array(32)
  for (let i = 0; i < 32; i++) lens[i] = 5
  return buildHuffman(lens, 32)
}

const FIXED_LIT_LEN = buildFixedLitLenTable()
const FIXED_DIST = buildFixedDistTable()

export function inflateZlib(input: Uint8Array, maxOutputBytes: number = 32 * 1024 * 1024): Uint8Array {
  if (input.length < 6) throw new Error('Zlib buffer too short')
  const cmf = input[0]!
  const flg = input[1]!
  if ((cmf & 0x0f) !== 8) throw new Error('Unsupported zlib compression method')
  if (((cmf << 8) | flg) % 31 !== 0) throw new Error('Invalid zlib header checksum')

  let startOffset = 2
  if ((flg & 0x20) !== 0) startOffset += 4 // preset dict

  const br = new BitReader(input, startOffset)
  let capacity = Math.min(maxOutputBytes, Math.max(4096, input.length * 4))
  let out = new Uint8Array(capacity)
  let outLen = 0

  const ensureCapacity = (extra: number): void => {
    const needed = outLen + extra
    if (needed > maxOutputBytes) throw new Error('Inflated output exceeds safety limit')
    if (needed <= capacity) return
    while (capacity < needed) {
      capacity = Math.min(maxOutputBytes, capacity * 2)
    }
    const next = new Uint8Array(capacity)
    next.set(out.subarray(0, outLen), 0)
    out = next
  }

  let isFinal = 0
  while (isFinal === 0) {
    isFinal = br.readBits(1)
    const btype = br.readBits(2)

    if (btype === 0) {
      br.alignToByte()
      const lo = br.readByteAligned()
      const hi = br.readByteAligned()
      const len = lo | (hi << 8)
      const nlo = br.readByteAligned()
      const nhi = br.readByteAligned()
      const nlen = nlo | (nhi << 8)
      if ((len ^ nlen) !== 0xffff) throw new Error('Invalid stored block length')
      ensureCapacity(len)
      for (let i = 0; i < len; i++) {
        out[outLen++] = br.readByteAligned()
      }
    } else if (btype === 1 || btype === 2) {
      let litLenTable: HuffmanTable
      let distTable: HuffmanTable

      if (btype === 1) {
        litLenTable = FIXED_LIT_LEN
        distTable = FIXED_DIST
      } else {
        const hlit = br.readBits(5) + 257
        const hdist = br.readBits(5) + 1
        const hclen = br.readBits(4) + 4
        const codeLens = new Int32Array(19)
        for (let i = 0; i < hclen; i++) {
          codeLens[CODE_LEN_ORDER[i]!] = br.readBits(3)
        }
        const clTable = buildHuffman(codeLens, 19)
        const total = hlit + hdist
        const allLens = new Int32Array(total)
        let idx = 0
        while (idx < total) {
          const sym = decodeSymbol(br, clTable)
          if (sym < 16) {
            allLens[idx++] = sym
          } else if (sym === 16) {
            if (idx === 0) throw new Error('Invalid repeat code in deflate header')
            const repeat = br.readBits(2) + 3
            const prev = allLens[idx - 1]!
            for (let r = 0; r < repeat && idx < total; r++) allLens[idx++] = prev
          } else if (sym === 17) {
            const repeat = br.readBits(3) + 3
            for (let r = 0; r < repeat && idx < total; r++) allLens[idx++] = 0
          } else if (sym === 18) {
            const repeat = br.readBits(7) + 11
            for (let r = 0; r < repeat && idx < total; r++) allLens[idx++] = 0
          } else {
            throw new Error('Invalid code length symbol')
          }
        }
        litLenTable = buildHuffman(allLens, hlit)
        const distLens = new Int32Array(hdist)
        for (let i = 0; i < hdist; i++) distLens[i] = allLens[hlit + i]!
        distTable = buildHuffman(distLens, hdist)
      }

      while (true) {
        const sym = decodeSymbol(br, litLenTable)
        if (sym < 256) {
          ensureCapacity(1)
          out[outLen++] = sym
        } else if (sym === 256) {
          break
        } else {
          const lenIdx = sym - 257
          if (lenIdx < 0 || lenIdx >= LENGTH_BASE.length) throw new Error('Invalid length symbol')
          const matchLen = LENGTH_BASE[lenIdx]! + br.readBits(LENGTH_EXTRA[lenIdx]!)
          const distSym = decodeSymbol(br, distTable)
          if (distSym < 0 || distSym >= DIST_BASE.length) throw new Error('Invalid distance symbol')
          const dist = DIST_BASE[distSym]! + br.readBits(DIST_EXTRA[distSym]!)
          if (dist > outLen) throw new Error('Invalid back-reference distance')
          ensureCapacity(matchLen)
          for (let k = 0; k < matchLen; k++) {
            out[outLen] = out[outLen - dist]!
            outLen++
          }
        }
      }
    } else {
      throw new Error('Reserved deflate block type')
    }
  }

  return out.subarray(0, outLen)
}

// Wraps raw bytes in a valid RFC 1950 zlib stream using uncompressed stored deflate blocks
export function zlibWrapUncompressed(raw: Uint8Array): Uint8Array {
  const maxBlock = 65535
  const blockCount = Math.max(1, Math.ceil(raw.length / maxBlock))
  const totalLen = 2 + raw.length + blockCount * 5 + 4
  const out = new Uint8Array(totalLen)
  out[0] = 0x78
  out[1] = 0x01

  let pos = 2
  let src = 0
  for (let b = 0; b < blockCount; b++) {
    const isFinal = b + 1 === blockCount ? 1 : 0
    const len = Math.min(maxBlock, raw.length - src)
    const nlen = len ^ 0xffff
    out[pos++] = isFinal
    out[pos++] = len & 0xff
    out[pos++] = (len >>> 8) & 0xff
    out[pos++] = nlen & 0xff
    out[pos++] = (nlen >>> 8) & 0xff
    if (len > 0) {
      out.set(raw.subarray(src, src + len), pos)
      pos += len
      src += len
    }
  }

  // Adler-32 checksum
  let s1 = 1
  let s2 = 0
  for (let i = 0; i < raw.length; i++) {
    s1 = (s1 + raw[i]!) % 65521
    s2 = (s2 + s1) % 65521
  }
  const adler = ((s2 << 16) | s1) >>> 0
  out[pos++] = (adler >>> 24) & 0xff
  out[pos++] = (adler >>> 16) & 0xff
  out[pos++] = (adler >>> 8) & 0xff
  out[pos++] = adler & 0xff
  return out
}
