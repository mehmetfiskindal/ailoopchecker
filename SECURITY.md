# Güvenlik ve Gizlilik Politikası / Security & Privacy Policy

## Gizlilik ve Veri Güvenliği Modeli

`ailoopchecker` **%100 çevrimdışı (offline)** ve **salt-okunur (read-only)** adli analiz aracı olarak tasarlanmıştır:

- **Sıfır ağ erişimi:** Uygulama hiçbir HTTP/HTTPS/DNS/soket modülü içermez, hiçbir sunucuya dosya, özet (hash), metaveri veya telemetri göndermez.
- **Sıfır disk yazma:** İncelenen medya dosyaları değiştirilmez, geçici dosya veya log üretilmez.
- **Minimal yerel kütüphane yüzeyi:** Native ELF ikili dosyası yalnızca temel C/C++ çalışma zamanına ve SHA-256 için sistem `libcrypto` kütüphanesine bağlanır; `node:zlib`/`libbrotlidec` bağlantısı yoktur (PNG sıkıştırma açma saf TypeScript RFC 1950/1951 `src/inflate.ts` ile yapılır).

## Kötü Niyetli / Bozuk Dosyalara Karşı Savunma Sınırları

Adli araçlar güvenilmeyen medya dosyalarını işlediği için yerleşik kaynak sınırları uygulanır:

| Katman | Koruma | Limit |
| --- | --- | --- |
| `src/inflate.ts` | Zip-bomb koruması | Varsayılan `32 MB` açılmış çıktı tavanı (`zTXt`/`iTXt` için `1 MB`) |
| `src/analyzers/image.ts` | Piksel bellek koruması | En fazla `6.000.000` piksel (~6 MP) ve `32 MB` ham `IDAT` |
| `src/analyzers/video.ts` | Kutu özyineleme & örnek limiti | En fazla `10` seviye iç içe kutu, `stts` en fazla `4096` giriş, `stsz` en fazla `2000` kare örneği |
| `src/analyzers/audio.ts` | DSP bellek & süre limiti | İlk `15 saniye` / en fazla `720.000` örnek ve en fazla `80` STFT çerçevesi |

> **Not:** `@geastack/node-compat`'ın `fs.promises.readFile` işlevi dosyayı tek seferde belleğe okur. Çok büyük (çok GB'lık) ham video dosyalarını incelerken sistem RAM sınırlarınızı göz önünde bulundurun.

## Güvenlik Açığı Bildirimi

Aşağıdaki türde bir güvenlik zafiyeti tespit ederseniz lütfen herkese açık issue açmak yerine gizli güvenlik bildirimi (*GitHub Security Advisory* veya proje bakımcılarıyla doğrudan iletişim) kullanın:

- Bozuk/özel hazırlanmış bir medya dosyasının native ikilide bellek taşması, çökme (*segfault*) veya sonsuz döngüye yol açması
- Zip-bomb veya yüksek bellek tüketimiyle hizmet aksatma (DoS)
- Komut enjeksiyonu veya beklenmeyen dosya sistemi/ağ erişimi

### Bildirimde Yer Alması Gerekenler
1. Etkilenen sürüm (`./dist/ailoopchecker --version`) ve işletim sistemi/mimari
2. Sorunu yeniden üreten en küçük dosya veya oluşturma betiği
3. Gözlenen ve beklenen davranış

Bildirimler en geç **72 saat** içinde değerlendirilir ve düzeltme yayınlanana kadar koordineli ifşa (*coordinated disclosure*) uygulanır.
