# Katkı Rehberi / Contributing to ailoopchecker

`ailoopchecker` topluluğuna hoş geldiniz! Yeni AI üretici imzaları, medya konteyner çözümleyicileri, DSP/piksel adli metrikleri, dokümantasyon iyileştirmeleri ve hata düzeltmeleri için tüm katkılar memnuniyetle karşılanır.

---

## Geliştirme Ortamı Gereksinimleri

- **Node.js** `>= 22.15.0` (doğrudan `.ts` çalıştırma ve `geatsc` derleyicisi için)
- **geatsc** (`@geastack/compiler` veya global `@geastack/cli`)
- **C++ derleyicisi:** `clang++` (önerilen) veya `g++` (Linux/macOS) + sistem `libcrypto` (OpenSSL, SHA-256 için)

### Hızlı Başlangıç

```bash
# 1. Node.js üzerinde yerleşik testleri çalıştır
npm test

# 2. Native C++ ikili dosyasını derle (dist/ailoopchecker)
npm run build

# 3. Native ikili üzerinde yerleşik testleri doğrula
npm run test:native
```

---

## `geatsc` AOT Derleme Kuralları (Önemli)

`ailoopchecker`, aynı TypeScript kaynağından **JavaScript motoru olmayan native C++ ikili dosyası** üretir. Katkı yaparken sıfır derleme reddi (*0 emission refusals*) için şu kurallara uyun:

1. **Kesin statik tipler kullanın:** `any` kullanmayın; tüm fonksiyon parametreleri, dönüş tipleri, diziler ve kayıt alanları açıkça tiplendirilmiş olmalıdır.
2. **Yalnızca `@geastack/node-compat` destekli modülleri içe aktarın:**
   - İzin verilenler: `node:fs` (`promises.readFile`, `statSync`, `existsSync`), `node:path`, `node:crypto`, `node:buffer`, `node:process` (`env`).
   - Kullanmayın: `node:child_process`, `node:https`, `node:http` (çevrimdışı gizlilik ilkesi gereği ağ yok), `fs.readFileSync`, `fs.readdirSync`, `node:zlib` (sıkıştırma için saf TypeScript `src/inflate.ts` kullanılır).
3. **Göreli içe aktarmalarda `.ts` uzantısı kullanın:** Hem Node 22 hem `geatsc` ile uyumlu olması için `import { ... } from './bytes.ts'` biçimini koruyun.
4. **Tek argümanlı olmayan `JSON.stringify` yerine `src/report.ts` serileştiricisini kullanın:** `geatsc` replacer/indent argümanlı `JSON.stringify(obj, null, 2)` çağrısını statik kayıtlarda reddeder.
5. **Çevrimdışı ve salt-okunur kalma ilkesi:** İncelenen dosyalara veya diske yazma, ağ isteği veya telemetri ekleyen PR'lar kabul edilmez.

---

## Nasıl Katkı Sağlayabilirsiniz?

### 1. Yeni AI Üretici İmzası Ekleme
- `src/signatures.ts` içindeki `AI_SIGNATURE_RULES` listesine yeni kural ekleyin (`id`, `pattern`, `generator`, `category`, `scoreDelta`, `strong`).
- Yanlış pozitif (*false positive*) riskini azaltmak için genel kelimeler yerine üreticiye özgü belirteçler seçin (ör. `runway gen-` veya `klingai`, tek başına `gen` değil).
- `src/selftest.ts` içine en az bir sentetik doğrulama vakası ekleyin.

### 2. Yeni Medya Formatı veya Sinyal/DSP Metriği Ekleme
- İlgili çözümleyiciyi güncelleyin:
  - Görsel: `src/analyzers/image.ts`
  - Video: `src/analyzers/video.ts`
  - Ses: `src/analyzers/audio.ts`
  - Metin: `src/analyzers/text.ts`
- Her yeni bulgu için hem **Türkçe (`titleTr`, `detailTr`)** hem **İngilizce (`titleEn`, `detailEn`)** açıklamalar ekleyin.
- Bellek ve döngü sınırları ekleyin (bozuk/kötü niyetli dosyalarda OOM veya sonsuz döngü olmamalı).

### 3. Yanlış Pozitif / Yanlış Negatif Bildirme
- Gerçek dosya paylaşmadan (gizlilik için), `./dist/ailoopchecker -v --json <dosya>` çıktısındaki anonimleştirilmiş metrikleri `.github/ISSUE_TEMPLATE/new_signature.md` şablonuyla paylaşın.

---

## Pull Request Kontrol Listesi

- [ ] `npm test` (Node.js 22) tüm testlerden geçti.
- [ ] `npm run build` sıfır `geatsc` hatası ve sıfır C++ derleme hatası ile tamamlandı.
- [ ] `npm run test:native` çıktısı Node.js çıktısıyla birebir aynı karar/skorları üretti.
- [ ] Yeni bulgular hem Türkçe hem İngilizce metin içeriyor.
- [ ] Gerekliyse `README.md`, `CHANGELOG.md` ve `docs/` güncellendi.
