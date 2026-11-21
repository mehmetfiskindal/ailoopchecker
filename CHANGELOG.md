# Changelog

Bu proje [Keep a Changelog](https://keepachangelog.com/tr/1.1.0/) biçimini ve [SemVer](https://semver.org/) sürümlemeyi takip eder.

## [1.0.0] - 2026-11-21

### Eklendi
- `geatsc` (`@geastack/compiler` + `@geastack/node-compat`) ile native C++ ikili dosyaya (`dist/ailoopchecker`) derlenen ilk sürüm.
- **Görsel / Ürün adli çözümleyicisi** (`PNG`, `JPEG`, `WebP`, `BMP`, `GIF`, `TIFF`): C2PA/JUMBF, IPTC `DigitalSourceType`, PNG `tEXt`/`zTXt`/`iTXt` ve XMP taraması, EXIF IFD0/ExifIFD kamera zinciri doğrulaması, tam PNG `IDAT`/BMP piksel çözümleme + 2D Laplacian ve VAE/upsampler ızgara otokorelasyonu.
- **Video adli çözümleyicisi** (`MP4`, `MOV`, `WebM`, `MKV`, `AVI`): özyinelemeli ISO Base Media kutu çözümleyici, C2PA/XMP UUID tespiti, `4k+1` 3D-VAE zamansal kare sayısı, sessiz klip, sıfır zaman damgası ve `stsz` kare boyutu varyansı analizi.
- **Ses kaydı adli çözümleyicisi** (`WAV`, `MP3`, `FLAC`, `OGG`, `Opus`, `M4A`): 1024-noktalı Radix-2 Cooley-Tukey STFT/FFT motoru, sinir vocoder yüksek frekans kesilme (brickwall) tespiti, dijital-sıfır sessizlik vs. doğal oda gürültüsü analizi ve yüksek bant tarak (comb) ölçümü.
- **Metin / Ürün açıklaması çözümleyicisi** (`TXT`, `MD`, `HTML`, `JSON`): Türkçe ve İngilizce LLM kalıp yoğunluğu, cümle uzunluğu değişkenliği (*burstiness*) ve şablon biçimlendirme tespiti.
- **Saf TypeScript RFC 1950/1951 `inflateZlib`** (`src/inflate.ts`) — sistem `libbrotlidec` bağlantısı olmadan güvenli sıkıştırma açma.
- **CLI özellikleri:** çoklu dosya tarama, `--json`, `-v/--verbose`, `--strict` (exit code `2`), `--threshold`, `--lang <tr|en>`, `--no-color`, `--self-test` (7 sentetik adli test).
- **Topluluk dokümanları:** `LICENSE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `docs/ARCHITECTURE.md`, `docs/DETECTION_GUIDE.md` ve GitHub issue/PR şablonları.
