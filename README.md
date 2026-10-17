# akademi_site

Akademik Koç (YKS akademik takip sistemi) arayüzünün şifreli yayın kopyası.

Adres: https://ramazan9838.github.io/akademi_site/

Bu repodaki içerik AES-256-GCM ile şifrelenmiştir; kullanıcı adı ve şifre olmadan okunamaz.
Kaynak özel repoda tutulur ve `yayin/sifrele.mjs` ile buraya yayımlanır. Bu repoda elle değişiklik yapmayın.

- `index.html` giriş sayfası · `sw.js` dosyaları tarayıcıda çözen service worker
- `k/` şifreli site dosyaları · `kasa.json` kullanıcıya özel sarılmış anahtarlar
- `ilk-veri.bin` ilk (boş) şifreli veritabanı · `veri` dalı: `veri.bin`, güncel şifreli veritabanı. Uygulamadan yapılan
  her kayıt orada yeni bir sürümdür (otomatik yedek). Dal, ilk kayıtta uygulama tarafından oluşturulur.
