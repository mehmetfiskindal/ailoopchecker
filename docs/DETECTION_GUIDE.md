# Tespit ve Yorumlama Rehberi / Detection Guide

Bu rehber, `ailoopchecker` raporlarındaki kararları, skorları, adli metrikleri ve sınırları doğru yorumlamanıza yardımcı olur.

---

## Karar Seviyeleri (Verdicts)

| Karar | Varsayılan Skor | Anlamı |
| --- | --- | --- |
| `CONFIRMED_AI` | `>= 82` veya kritik imza | Dosyada C2PA/IPTC AI köken beyanı, doğrudan AI üretici/parametre metaverisi veya çok güçlü birleşik sentetik adli kanıtlar bulundu. |
| `LIKELY_AI` | `>= threshold` (varsayılan `60`) | Birden fazla bağımsız konteyner/sinyal/stilometri bulgusu AI üretimine işaret ediyor. |
| `INCONCLUSIVE` | `33 – 59` | Ne kesin AI ne de güçlü otantik kanıt mevcut (ör. sosyal medyadan indirilip metaverisi silinmiş görsel/video). |
| `LIKELY_AUTHENTIC` | `<= 32` | Gerçek kamera/cihaz/mikrofon izleri veya doğal sensör/akustik/dil profili baskın. |

> **Önemli:** Adli analiz olasılıksaldır. `CONFIRMED_AI` dışındaki kararlar tek başına hukuki/disipliner kanıt olarak değil, **önceliklendirme ve inceleme sinyali** olarak kullanılmalıdır.

---

## Temel Sinyal Metrikleri Nasıl Okunur?

### Görseller (`PNG`, `BMP`, `JPEG`, `WebP`)
- `pixel_grid_autocorr_peak`: Yüksek frekanslı Laplacian piksel kalıntılarında 2/4/8 piksel aralıklı periyodik sıçrama. `> 0.14` değeri VAE/transposed-convolution upsampler izi olarak işaretlenir.
- `pixel_laplacian_mean_abs` ve `pixel_block_variance_cv`: Gerçek kamera fotoğrafları doğal sensör gürültüsü ve doku varyansı gösterir; aşırı pürüzsüz ve tekdüze profil sentetik üretim sinyali verir.
- `exif_make` / `exif_model` + optik etiketler: Enstantane, diyafram, ISO ve odak uzaklığı birlikte mevcutsa otantik kamera lehine güçlü puan düşümü uygulanır.

### Videolar (`MP4`, `MOV`, `WebM`, `AVI`)
- `video_frame_count`: `49, 65, 81, 97, 121, 161, 241` gibi `4k+1` kare sayıları 3D-VAE tabanlı AI video modellerinin (Wan, CogVideoX, HunyuanVideo, LTX-Video vb.) karakteristik pencere boyutudur.
- `has_audio_track = no` + kısa süre (`<= 25 sn`): Birçok ham AI video çıktısı sessiz üretilir.
- `video_frame_size_cv`: `stsz` kare boyutlarının değişim katsayısı. Aşırı düşük varyans (`< 0.22`) + tek girişli `stts` sabit CFR, sentetik kodlamaya işaret eder.

### Ses Kayıtları (`WAV`, `MP3`, `FLAC`, `OGG`, `Opus`)
- `audio_8khz_cutoff_drop_db` / `audio_11khz_cutoff_drop_db`: 44.1/48 kHz taşıyıcı içinde 8–12 kHz üzerinde `>= 26 dB` sert enerji düşüşü, 16/22/24 kHz sinir vocoder (HiFi-GAN, EnCodec, TTS) kesilmesidir.
- `audio_sterile_silence_ratio` vs `audio_room_tone_ratio`: Gerçek mikrofon kayıtlarında konuşma aralarında `-68` ile `-36 dBFS` arasında sürekli ortam gürültüsü bulunur; sentetik TTS kayıtlarında aralıklar `-82 dBFS` altı dijital sıfıra düşer.
- `audio_vocoder_comb_peak`: 3–10 kHz bandındaki periyodik tarak (comb) otokorelasyonu.

### Metin / Ürün Açıklamaları (`TXT`, `MD`, `HTML`, `JSON`)
- `text_ai_phrase_hits`: Türkçe ve İngilizce LLM klişe/geçiş ifadelerinin sayısı.
- `text_burstiness_cv`: Cümle uzunluğu varyansı; `< 0.24` aşırı tekdüze LLM ritmine, `>= 0.45` doğal insan yazım ritmine işaret eder.

---

## Bilinen Sınırlamalar

1. **Yeniden kodlama ve metaveri silme:** WhatsApp, Instagram, X/Twitter gibi platformlar EXIF/C2PA/PNG chunk'larını siler ve görsel/videoyu yeniden sıkıştırır; bu durumda skor `INCONCLUSIVE` bölgesine çekilebilir.
2. **Sıkıştırılmış ses formatları (`MP3`, `OGG`, `M4A`):** Tam FFT/STFT DSP analizi şu an kayıpsız/PCM/Float `WAV` dosyalarında çalışır; sıkıştırılmış ses dosyalarında konteyner, ID3/Vorbis etiketleri, örnekleme/bitrate profili ve C2PA/üretici imzaları incelenir.
3. **Stüdyo gürültü kapısı (Noise Gate):** Profesyonel podcast kayıtlarında agresif gürültü kapısı uygulanmışsa `sterile_silence_ratio` yükselebilir; bu yüzden tek başına bir bulgu `LIKELY_AI` kararı vermeye yetmez.

---

## CI / Otomasyon Kullanımı

```bash
# Bir klasördeki tüm görselleri JSON olarak raporla ve AI bulunursa pipeline'ı durdur (exit 2)
./dist/ailoopchecker --strict --json assets/*.png > ai-audit.json
```

### Çıkış Kodları
- `0`: Analiz tamamlandı (`--strict` kapalıysa her zaman, `--strict` açıkken AI bulunmadıysa).
- `1`: Geçersiz argüman, dosya bulunamadı veya çalışma zamanı hatası.
- `2`: `--strict` etkinken en az bir dosya `LIKELY_AI` veya `CONFIRMED_AI` olarak işaretlendi.
