---
name: Yeni AI İmzası veya Yanlış Karar / New Signature or Misclassification
about: Yeni bir AI üretici imzası önerin veya yanlış pozitif/negatif bildirin
title: "[SIGNATURE] "
labels: enhancement, forensics
---

## Tür
- [ ] Yeni AI görsel/video/ses üretici imzası
- [ ] Yanlış Negatif (AI üretimi dosya tespit edilmedi)
- [ ] Yanlış Pozitif (Gerçek/otantik dosya AI olarak işaretlendi)

## Medya Bilgisi
- Kategori: [ ] Görsel/Ürün  [ ] Video  [ ] Ses Kaydı  [ ] Metin
- Format (PNG, JPEG, MP4, WAV, MP3, vb.):
- Bilinen üretici / cihaz (ör. Kling 2.0, ElevenLabs v3, Sony A7IV):

## Anonimleştirilmiş `ailoopchecker -v --json` Çıktısı
> **Gizlilik uyarısı:** Paylaşmadan önce dosya yollarını ve hassas kişisel metaverileri temizleyin.

```json
{
  "paste": "redacted output here"
}
```

## Önerilen İmza / Kural
Dosya başlığında, metaveride veya sinyalde gözlenen ayırt edici izi yazın.
