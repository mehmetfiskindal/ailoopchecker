# Changelog

Bu proje [Keep a Changelog](https://keepachangelog.com/tr/1.1.0/) biçimini ve [SemVer](https://semver.org/) sürümlemeyi takip eder.

## [1.0.2] - 2026-11-21

### Düzeltildi
- **Windows:** JS CLI yedeği `pathToFileURL` ile yükleniyor (`ERR_UNSUPPORTED_ESM_URL_SCHEME` hatası giderildi).
- `--version` ve JSON raporlarındaki `"version"` alanı artık doğru sürümü gösteriyor; sürüm `src/shared/version.ts` içinde tek yerde tutuluyor ve `build:npm` `package.json` ile uyuşmazlıkta duruyor.
- Yayınlanan `.d.ts` dosyalarındaki `./x.ts` import yolları `./x.js` olarak yeniden yazılıyor (`skipLibCheck: false` tüketicilerde tip hatası giderildi).
- Dizin taramasında git ve git dışı mod aynı klasör filtresini kullanıyor; `lib/` artık atlanmıyor, commit'lenmiş `vendor/`/`dist/` artık taranmıyor.
- `--project-name`, `--lang`, `--threshold`, `--file-list` değerleri artık yanlışlıkla taranacak dizin olarak algılanmıyor.
- Dizin ile birlikte verilen `--file-list` artık sessizce yok sayılmıyor; listeler birleştiriliyor.
- Geçici dosya listesi `mkdtemp` ile özel bir dizinde, NUL ayraçlı olarak oluşturuluyor (`#` ile başlayan veya boşluk içeren dosya adları kaybolmuyor).
- Build script'leri `which`/kabuk kullanmadan platformdan bağımsız araç buluyor ve başlatma hatalarını yazdırıyor.

### Değişti
- `@geastack/compiler`, `@geastack/node-compat` ve `typescript` devDependency olarak eklendi.
- `prepublishOnly` self-test'i derlenmiş `lib/cli.js` üzerinden çalıştırıyor (Node 22.15'te tip temizleme bayrağı gerekmiyor).

## [1.0.1] - 2026-11-21

### Eklendi
- npm dağıtımı: derlenmiş `lib/` (JS + `.d.ts`), `#!/usr/bin/env node` içeren `bin/ailoopchecker.mjs` ve doğrudan dizin tarama desteği.

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
