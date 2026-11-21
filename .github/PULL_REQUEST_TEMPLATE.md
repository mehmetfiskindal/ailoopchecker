## Özet
Bu PR neyi değiştiriyor veya ekliyor?

## Değişiklik Türü
- [ ] Yeni AI üretici imzası (`src/signatures.ts`)
- [ ] Çözümleyici / DSP / adli kural iyileştirmesi (`src/analyzers/`)
- [ ] Hata düzeltmesi
- [ ] Dokümantasyon

## Doğrulama Kontrol Listesi
- [ ] `npm test` (Node.js 22 `--self-test`) geçti
- [ ] `npm run build` (`geatsc` → native C++ derlemesi) 0 hata ile tamamlandı
- [ ] `npm run test:native` (`./dist/ailoopchecker --self-test`) Node.js ile aynı sonuçları üretti
- [ ] Yeni bulgular hem Türkçe hem İngilizce (`titleTr`/`titleEn`, `detailTr`/`detailEn`) içeriyor
- [ ] Ağ erişimi, diske yazma veya `geatsc` ile uyumsuz Node API'si eklenmedi
