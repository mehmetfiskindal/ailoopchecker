# Mimari Genel Bakış / Layered Architecture

`ailoopchecker`, tek bir statik tipli TypeScript kod tabanından hem **Node.js 22+** üzerinde doğrudan çalıştırılabilir hem de **`geatsc` (AOT TypeScript → C++)** ile bağımsız native ikili dosyaya (`dist/ailoopchecker`) derlenebilir biçimde **4 katmanlı (`shared` → `core` → `features` → `product`)** olarak yapılandırılmıştır.

---

## 1. Katman Yapısı ve Bağımlılık Kuralları

```text
src/
├── shared/                      # Katman 1: Alandan bağımsız temel tipler ve ikili/sıkıştırma yardımcıları
│   ├── types.ts                 # Ortak veri sözleşmeleri (MediaCategory, Verdict, ProjectAuditReport, CliOptions)
│   ├── bytes.ts                 # Endian-güvenli okuyucular, magic-byte tespiti, O(N) bayt-düzeyi UTF-8 CI arama
│   └── inflate.ts               # Saf TypeScript RFC 1950/1951 zlib inflate (libbrotlidec bağımlılığı yok)
│
├── core/                        # Katman 2: Çekirdek adli motor ve proje AI-Loop orkestrasyonu
│   ├── signatures.ts            # C2PA/JUMBF, IPTC DigitalSourceType ve 60+ AI üretici imza tarayıcı
│   ├── scoring.ts               # Kalibre edilmiş dosya skoru, doğrulama tavanı (58) ve karar motoru
│   ├── analyzer.ts              # Dosya/tampon okuma, SHA-256 ve ilgili feature çözümleyicisine yönlendirme
│   └── project-audit.ts         # Proje düzeyi AI-Loop birleştirme, çapraz tekrar (FNV-1a) ve çok katmanlı yığın analizi
│
├── features/                    # Katman 3: Bağımsız dikey adli özellik modülleri
│   ├── image/analyzer.ts        # Görsel/ürün adli analizi (PNG/JPEG/WebP/BMP/GIF/TIFF + Laplacian/VAE ızgara)
│   ├── video/analyzer.ts        # Video konteyner analizi (MP4/MOV ISOBMFF, WebM/MKV, AVI, 4k+1 kare, stts/stsz)
│   ├── audio/analyzer.ts        # Ses ve DSP analizi (WAV 1024-pt Radix-2 STFT/FFT, MP3, FLAC, OGG/Opus)
│   ├── code/analyzer.ts         # 21 modern dil için kaynak kod ve otonom/sınırsız AI-Loop tespiti
│   └── text/analyzer.ts         # Türkçe/İngilizce ürün metni ve doküman stilometrisi (O(N) bayt tarama)
│
├── product/                     # Katman 4: Ürün teslim yüzeyleri (CLI, Raporlayıcı, SDK, Self-Test)
│   ├── cli.ts                   # CLI girişi (process.argv, --project, --file-list, --strict, --json)
│   ├── report.ts                # ANSI terminal ve deterministik JSON serileştiricileri (dosya + proje)
│   ├── selftest.ts              # 12 sentetik dosya + proje AI-Loop uçtan uca doğrulama vakası
│   └── index.ts                 # JS/TS SDK dışa aktarım kapısı
│
├── cli.ts                       # İnce uyumluluk girişi -> ./product/cli.ts
└── index.ts                     # İnce uyumluluk girişi -> ./product/index.ts
```

### Katı Bağımlılık Yönü (Döngüsel Bağımlılık Yok)
- **`shared/`** → başka hiçbir `src/` katmanına bağımlı değildir.
- **`features/*/`** → yalnızca `shared/` ve `core/signatures.ts` modüllerine bağımlıdır; feature'lar birbirini ithal etmez ve `product/` katmanını bilmez.
- **`core/`** → `shared/` ve (yönlendirici `core/analyzer.ts` üzerinden) `features/*/analyzer.ts` katmanlarını kullanır; `product/` katmanına bağımlı değildir.
- **`product/`** → `shared/`, `core/` ve `features/` katmanlarını birleştirerek CLI, terminal/JSON rapor, SDK ve self-test ürün yüzeylerini sunar.

---

## 2. Derleme ve Performans Tasarımı

```text
src/cli.ts -> src/product/cli.ts
        │
        ├──► Node.js 22+ (doğrudan çalıştırma)
        │
        └──► geatsc (@geastack/compiler + @geastack/node-compat)
                    │
                    ▼  (Sıfır JS motoru, statik C++ taşıyıcılar)
             dist/.geatsc/ailoopchecker/ailoopchecker.cpp
                    │
                    ▼  (clang++ veya g++, -O2/-Os, LTO, strip)
             dist/ailoopchecker  (native ELF ikili)
```

### Neden Bayt-Düzeyi `O(N)` Tarama (`shared/bytes.ts`)?
- `geatsc` C++ çalışma zamanında `std::string` UTF-8 tuttuğu için büyük stringler üzerinde `charCodeAt(i)` / `toLowerCase()` döngüleri `O(N²)` maliyet üretebilir.
- Bu nedenle `shared/bytes.ts` (`indexOfUtf8CI`), `core/signatures.ts` (`scanBytesForAiSignatures`), `core/project-audit.ts` (FNV-1a satır özeti), `features/text/analyzer.ts` ve `features/code/analyzer.ts` büyük dosyaları doğrudan `Uint8Array` baytları üzerinde `O(N)` hızda tarar.
- `shared/inflate.ts` içindeki saf TypeScript RFC 1950/1951 `inflateZlib` ise `node:zlib` üzerinden gelen `libbrotlidec` bağımlılığını ortadan kaldırır.

---

## 3. Skorlama ve Yanlış Pozitif Koruması

- **Dosya düzeyi ([src/core/scoring.ts](../src/core/scoring.ts)):**
  - Nötr taban `15`. Açık kritik AI köken imzası (`scoreDelta >= 45`) yoksa tek bir sezgisel bulgu skoru `58`'in üzerine çıkaramaz; `LIKELY_AI` (varsayılan eşik `60`) için en az 2 bağımsız bulgu gerekir.
  - Otantik kanıtlar (kamera EXIF `-24`, QuickTime cihaz etiketi `-22`, doğal mikrofon ortam gürültüsü `-18`, pragmatik kod işaretleri `-16`, BEXT `-12`) yanlış pozitifleri engeller.
- **Proje AI-Loop düzeyi ([src/core/project-audit.ts](../src/core/project-audit.ts)):**
  - AI dosya oranı, çok katmanlı AI yığını (`code` + `image`/`video`/`audio`/`text`), otonom/sınırsız LLM döngü kodu, LLM atlama yorumları (`... existing code`), anlamlı dosyalar arası (`>= 256 B`) FNV-1a çapraz şablon tekrarı ve ajan döngü yapılandırma dosyalarını birleştirerek `AI_LOOP_CONFIRMED`, `AI_LOOP_LIKELY`, `MIXED_AI_ASSISTED` veya `ORGANIC_PROJECT` kararını üretir.
