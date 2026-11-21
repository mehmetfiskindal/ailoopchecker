# ailoopchecker

**geatsc** (`@geastack/compiler` + `@geastack/node-compat`) ile saf TypeScript'ten **native C++ ikili dosyasına** derlenen, dış bağımlılıksız, çevrimdışı çalışan AI medya (görsel/ürün, video, ses kaydı ve ürün metni) adli tespit CLI uygulaması.

## Özellikler

- **Görsel / Ürün Tespiti (`PNG`, `JPEG`, `WebP`, `BMP`, `GIF`, `TIFF`):**
  - C2PA / JUMBF Content Credentials (`caBX`, `APP11`, `C2PA`) ve IPTC `DigitalSourceType` (`trainedAlgorithmicMedia`, `compositeWithTrainedAlgorithmicMedia`) taraması
  - PNG `tEXt`, `zTXt` (saf TypeScript native RFC 1950/1951 inflate), `iTXt` ve XMP metaverilerinden Stable Diffusion / A1111, ComfyUI, Midjourney, DALL-E, Flux, Adobe Firefly, Google Imagen/SynthID, NovelAI, InvokeAI imzalarını çıkarma
  - Gerçek EXIF IFD0 / ExifIFD optik kamera zinciri doğrulaması (üretici, model, enstantane, diyafram, ISO, odak uzaklığı)
  - Tam PNG `IDAT` ve BMP piksel çözümleme + 2D Laplacian gürültü kalıntısı ve 2/4/8 piksel VAE/upsampler ızgara periyodiklik otokorelasyonu
- **Video Tespiti (`MP4`, `MOV`, `WebM`, `MKV`, `AVI`):**
  - Özyinelemeli ISO Base Media (`ftyp`, `moov`, `mvhd`, `trak`, `tkhd`, `mdhd`, `hdlr`, `stsd`, `stts`, `stsz`, `stss`, `udta`, `meta`, `ilst`, `uuid`) kutu çözümleyici
  - C2PA & XMP UUID kutuları, Sora / Runway / Kling / Veo / Luma / Pika / HeyGen / Synthesia / Wan / HunyuanVideo / CogVideoX imza taraması
  - 3D-VAE zamansal difüzyon kare sayısı (`4k+1`: 49, 65, 81, 97, 121, 161, 241), sessiz kısa klip, 1904 sıfır zaman damgası, sabit CFR ve tekdüze `stsz` kare boyutu varyansı analizi
- **Ses Kaydı Tespiti (`WAV`, `MP3`, `FLAC`, `OGG`, `Opus`, `M4A`):**
  - PCM (8/16/24/32-bit) ve IEEE Float WAV örnekleri üzerinde **native 1024-noktalı Radix-2 Cooley-Tukey Hann-pencereli STFT/FFT** analizi
  - Sinir vocoder (HiFi-GAN / EnCodec / TTS) keskin yüksek frekans kesilmesi (~8 / ~11 / ~12 kHz brickwall) tespiti
  - Dijital-sıfır sessizlik tabanı vs. doğal mikrofon/oda gürültüsü (`room tone`) ayrımı ve yüksek bant tarak (comb) periyodikliği
  - ID3v2/ID3v1, FLAC Vorbis Comment, BEXT ve ElevenLabs / Suno / Udio / XTTS / MusicGen / Bark imza taraması
- **Kaynak Kod Tespiti (Modern Diller):** `TypeScript` (`.ts`/`.tsx`/`.mts`), `JavaScript` (`.js`/`.jsx`/`.mjs`/`.cjs`), `Python`, `Rust`, `Go`, `Swift`, `Kotlin`, `Java`, `C#`, `C/C++`, `Zig`, `Mojo`, `Gleam`, `Elixir`, `Ruby`, `PHP`, `Dart`, `Scala`, `SQL`, `Shell` (+ shebang tanıma):
  - Açık AI araç imzaları (Claude, ChatGPT, Copilot, Cursor, Gemini, Windsurf, Devin, DeepSeek), LLM atlama yorumları (`... existing code`, `... rest of implementation`), numaralı adım anlatımları (`Step 1 / 1.`), satır-satır anlatım yoğunluğu, yorum içi uzun tire/emoji tipografisi ve şablon dokümantasyon analizi
  - Gerçek insan mühendisliği izleri (`FIXME`, ticket/PR referansları, linter/derleyici baskılamaları, sade anlatımsız stil) için yanlış pozitif koruması
- **JS/TS Kütüphane (SDK) Desteği:** `import { analyzeFile, analyzeBuffer } from 'ailoopchecker'` (`package.json` `exports` -> `src/index.ts`)
- **Metin / Ürün İçeriği Tespiti (`TXT`, `MD`, `HTML`, `JSON`):**
  - Türkçe & İngilizce LLM kalıp ifade yoğunluğu, cümle uzunluğu değişkenliği (*burstiness*) ve şablon biçimlendirme analizi

## Kurulum ve Kullanım

### npm üzerinden kullanım (Node.js 22+)

```bash
# Tek seferlik çalıştırma (dosya veya tüm proje klasörü)
npx ailoopchecker urun.png video.mp4 ses.wav
npx ailoopchecker ./proje-dizini

# Global kurulum
npm install -g ailoopchecker
ailoopchecker ./proje-dizini --strict --json
```

```ts
// JS/TS projelerinde SDK olarak kullanım
import { analyzeFile, analyzeBuffer, auditProjectFiles } from 'ailoopchecker'

const report = await analyzeFile('./src/service.ts', 60)
console.log(report.verdict, report.aiScore)
```

### Native `geatsc` ikili dosyasını derleme

```bash
npm install        # devDependencies: @geastack/compiler, @geastack/node-compat, typescript
npm run build      # optimizasyonsuz derleme için: npm run build:debug
```

Bu komut `geatsc` ile `src/cli.ts` kaynağını C++'a derler ve `./dist/ailoopchecker` native çalıştırılabilir dosyasını üretir. `clang++` veya `g++` gereklidir (farklı bir derleyici için `CXX` ortam değişkenini ayarlayın). Proje içinde `@geastack/node-compat` yoksa global `@geastack/cli` (`gea`) kurulumundaki kopya kullanılır.

npm dağıtımı (`lib/` içindeki JS + `.d.ts`) için `npm run build:npm` kullanılır; `npm publish` bunu `prepublishOnly` ile otomatik çalıştırır. Sürüm numarası `package.json` ve `src/shared/version.ts` içinde aynı olmalıdır, aksi halde build durur.

Bir dizin verildiğinde `node_modules`, `dist`, `build`, `target`, `vendor`, `coverage` gibi çıktı/bağımlılık klasörleri hem git hem git dışı modda atlanır; `lib/` ve `src/` gibi kaynak klasörleri taranır.

### Kullanım

```bash
# Yerleşik sentetik adli test paketini çalıştır
./dist/ailoopchecker --self-test

# Tek veya çoklu dosya analizi (görsel, video, ses, kod, metin)
./dist/ailoopchecker urun.png reklam.mp4 ses_kaydi.wav app.ts aciklama.md

# Tüm bir projeyi AI-Loop denetimi için tara (önerilen tek komut)
./scripts/scan-project.sh /yol/proje_dizini
./scripts/scan-project.sh /yol/proje_dizini --json --strict

# Doğrudan proje modu (dosya listesi veya glob ile)
./dist/ailoopchecker --project src/*.ts README.md assets/*.png
./dist/ailoopchecker --project --file-list dosyalar.txt --strict

# Ayrıntılı adli rapor (metaveri, DSP/piksel metrikleri, SHA-256)
./dist/ailoopchecker -v ses_kaydi.wav

# CI / otomasyon için JSON ve katı çıkış kodu (AI tespitinde exit code 2)
./dist/ailoopchecker --json --strict urun.png

# İngilizce çıktı
./dist/ailoopchecker --lang en urun.png
```

Aynı TypeScript kaynak kodu derleme olmadan doğrudan Node.js 22+ ile de çalışır:

```bash
node src/cli.ts --self-test
```

## Topluluk ve Dokümantasyon

- **Mimari ve `geatsc` Derleme Hattı:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- **Skor, Karar ve Metrik Yorumlama Rehberi:** [docs/DETECTION_GUIDE.md](docs/DETECTION_GUIDE.md)
- **Katkı Rehberi:** [CONTRIBUTING.md](CONTRIBUTING.md)
- **Güvenlik ve Gizlilik Politikası:** [SECURITY.md](SECURITY.md)
- **Davranış Kuralları:** [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- **Sürüm Geçmişi:** [CHANGELOG.md](CHANGELOG.md)
- **Lisans:** [Apache-2.0](LICENSE)
- **AI Ajan Geliştirme Yetenekleri (Skills):** `.agents/skills/` (`ailoopchecker-geatsc-dev`, `ailoopchecker-forensic-analyzers`, `ailoopchecker-signatures`, `ailoopchecker-cli-audit`)

