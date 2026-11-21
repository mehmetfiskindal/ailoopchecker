# Mimari Genel Bakış / Architecture

`ailoopchecker`, tek bir statik tipli TypeScript kod tabanından hem **Node.js 22+** üzerinde doğrudan çalıştırılabilir hem de **`geatsc` (AOT TypeScript → C++)** ile bağımsız native ikili dosyaya (`dist/ailoopchecker`) derlenebilir biçimde tasarlanmıştır.

## 1. Derleme ve Çalıştırma Hattı

```text
src/cli.ts (+ src/**/*.ts)
        │
        ├──► Node.js 22+ (doğrudan çalıştırma: node src/cli.ts)
        │
        └──► geatsc (@geastack/compiler + @geastack/node-compat)
                    │
                    ▼  (Sıfır JS motoru, statik C++ taşıyıcılar)
             dist/.geatsc/ailoopchecker/ailoopchecker.cpp
                    │
                    ▼  (clang++ veya g++, -O2/-Os, LTO, strip)
             dist/ailoopchecker  (~2.9 MB native ELF ikili)
```

### Neden Saf TypeScript `inflateZlib`?
`PNG` dosyalarının `IDAT`, `zTXt` ve `iTXt` bloklarını açmak için RFC 1950/1951 deflate açıcı gerekir. `node:zlib` içe aktarımı `@geastack/node-compat` tarafında `libbrotlidec` bağlantısını da tetikler. `src/inflate.ts` içinde yazılan saf TypeScript `inflateZlib`, harici `libbrotlidec` bağımlılığını ortadan kaldırır ve `geatsc` tarafından doğrudan optimize C++ döngülerine derlenir.

---

## 2. Analiz Akışı

Her dosya [src/analyzer.ts](../src/analyzer.ts) üzerinden şu 5 aşamadan geçer:

1. **Dosya Okuma & SHA-256:** `fs.promises.readFile` ile salt-okunur bellek yüklemesi ve `node:crypto` üzerinden deterministik SHA-256 özeti.
2. **Sihirli Bayt (Magic Bytes) Tanıma ([src/bytes.ts](../src/bytes.ts)):** Uzantıya körü körüne güvenmek yerine ikili başlık imzalarına (`PNG`, `JPEG`, `WEBP`, `BMP`, `GIF`, `TIFF`, `RIFF/WAVE`, `RIFF/AVI`, `ftyp` MP4/MOV/M4A/AVIF, `EBML` WebM/MKV, `fLaC`, `OggS`/Opus, `ID3`/MPEG sync veya UTF-8 metin) göre kategori seçilir.
3. **Alana Özel Adli Çözümleyici:**
   - [src/analyzers/image.ts](../src/analyzers/image.ts): Konteyner/EXIF/XMP/C2PA + PNG/BMP piksel açma + 2D Laplacian & 2/4/8 piksel otokorelasyon.
   - [src/analyzers/video.ts](../src/analyzers/video.ts): Özyinelemeli ISO Base Media kutu ağacı + zamansal `4k+1` kare/CFR/GOP/`stsz` varyansı + WebM/AVI taraması.
   - [src/analyzers/audio.ts](../src/analyzers/audio.ts): WAV/MP3/FLAC/OGG/Opus konteynerleri + 1024-noktalı Radix-2 Cooley-Tukey Hann-pencereli STFT/FFT DSP motoru.
   - [src/analyzers/text.ts](../src/analyzers/text.ts): Türkçe/İngilizce LLM kalıp yoğunluğu, cümle uzunluğu *burstiness* CV'si ve şablon biçimlendirme taraması.
4. **Köken ve İmza Tarayıcı ([src/signatures.ts](../src/signatures.ts)):** Hem çıkarılmış metin bloklarında hem de ikili başlık/kuyruk pencerelerinde C2PA/JUMBF, IPTC `DigitalSourceType` ve 60+ bilinen AI görsel/video/ses üretici imzasını arar.
5. **Kalibre Edilmiş Skorlama ([src/scoring.ts](../src/scoring.ts)):** Pozitif AI bulgularını ve negatif otantik kanıtları (gerçek kamera EXIF, BEXT, QuickTime cihaz etiketleri, doğal mikrofon oda gürültüsü, doğal sensör gürültüsü) birleştirerek `0–100` arası `aiScore`, `confidence` ve `verdict` üretir.

---

## 3. Skorlama ve Yanlış Pozitif Koruması

- **Başlangıç tabanı:** `15` (nötr)
- **Doğrulama şartı:** Açık bir kriptografik/üretici imzası (`critical`, `scoreDelta >= 45`) yoksa tek bir zayıf sezgisel bulgu skoru `58`'in üzerine çıkaramaz; `LIKELY_AI` kararı (varsayılan eşik `60`) için en az iki bağımsız bulgunun örtüşmesi gerekir.
- **Kesin AI kuralı:** C2PA/IPTC `trainedAlgorithmicMedia` veya doğrudan üretici parametreleri (ör. A1111 `Steps/Sampler/CFG`, ComfyUI `KSampler`, ElevenLabs, Sora, Suno) bulunduğunda skor en az `85`, güven en az `%92` ve karar `CONFIRMED_AI` olur.
- **Otantik kanıtlar negatif ağırlık taşır:** Optik kamera EXIF zinciri (`-24`), akıllı telefon QuickTime cihaz etiketi + UTC zaman damgası (`-22`), doğal mikrofon oda gürültüsü (`-18`) ve BEXT başlığı (`-12`) yanlış pozitifleri önler.
