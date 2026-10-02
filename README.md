# scar

> Tekrar eden ajan hatalarını **deponun hatırladığı derslere** çevirir. Yerel oturum
> kayıtlarından (Claude Code, Codex CLI, Gemini CLI) **ayrı oturumlarda tekrar eden** hata
> desenlerini çıkarır, her biri için kural / regresyon testi brifingi / ortam düzeltmesi
> taslağı üretir ve sonra **dersin gerçekten tuttuğunu ölçer**.
> Ağ çağrısı yok, kota harcanmaz, repoya kendiliğinden hiçbir şey yazmaz.
>
> *English summary below.*

**Site:** https://halilneed.github.io/scar/

`agent-blackbox` **ne yanlış gitti** der. `scar` **bir daha olmasın** yazar — ve sonra
işe yarayıp yaramadığını ölçerek döngüyü kapatır.

## Ne yapar?

| Komut | Ne verir |
|---|---|
| `/scar:mine` | **Tekrar eden hatalar**: hangi hata kaç ayrı oturumda, kaç projede tekrar etti; başarısız komutlar ve sonrasında işe yarayan şey |
| `/scar:write <id>` | **Kalıcı ders**: kural, regresyon testi brifingi, ortam düzeltmesi ya da karar kaydı taslağı — kanıt satırı ve ölçüm işaretiyle |
| `/scar:verify` | **Ders tuttu mu?**: işaretli her artefakt için hatanın yazılmadan önceki ve sonraki tekrar sayısı |

## Neden "tekrar" eşiği?

Bir kez olan hata olaydır. **Sekiz ayrı oturumda tekrar eden hata sekiz kez unutulmuştur** —
yara izi budur. Tek bir oturumda yirmi kez denenmiş bir hata ise bir kez öğrenilecek tek
bir derstir.

Bu yüzden sıralama ham tekrar sayısına göre değil **maliyete** göre yapılır:

```
maliyet = ayrı oturum × 3 + proje × 2 + tekrar (üst sınırlı) + birden çok ajan ise +4
```

Ham sayıya göre sıralamak, tek bir kötü öğleden sonrayı listenin başına koyardı.

## Bir yara izi nasıl çıkarılıyor?

1. **Epizot** — bir ya da daha çok ardışık başarısız araç sonucu + sonrasındaki ilk başarı.
   Yeniden deneme döngüsü tek epizottur, yirmi değil.
2. **Hata satırı** — ajanın sarmalayıcı satırları (`Exit code:`, `Wall time:`, `Output:`)
   ayıklanır; Python geri izlemesi son satırına, PowerShell konum satırları atlanır. Hiçbir
   satır hataya benzemiyorsa epizot **düşük güvenli** işaretlenir ve varsayılan olarak elenir.
3. **İmza** — yollar, sayılar ve hash'ler yer tutucuya çevrilir; böylece iki farklı projedeki
   aynı hata tek yara izinde birleşir.
4. **Aile** — 16 şeffaf desen, dersin hangi biçimde yazılacağını belirler (kural / test /
   ortam / karar).

### Araç değişimi sinyali

Epizotların yarısından fazlası, hatanın çıktığı araçtan **farklı** bir araçla başarıya
ulaştıysa rapor bunu söyler. Bu en güçlü sinyaldir, çünkü ders düzeltilmiş bir komut değil,
düzeltilmiş bir **araç seçimidir**: *bu işi o araçla yapma*.

## Döngü nasıl kapanıyor?

Üretilen her artefakt bir işaret taşır:

```
<!-- scar:scar-0eqc684 -->
```

`/scar:verify` bu işareti arar, dosyanın tarihini dersin yazıldığı an olarak alır ve hatanın
o tarihten önceki/sonraki tekrarlarını sayar. Dört hüküm üretir:

| Hüküm | Anlamı |
|---|---|
| **tuttu** | Önce oluyordu, yazıldıktan sonra hiç olmadı, üzerinden yeterli zaman geçti |
| **tekrar etti** | Kural yazıldı ama hata sürüyor — kural ya okunmuyor ya yanlış |
| **çok yeni** | Bir haftadan yeni; henüz bir şey kanıtlamıyor |
| **kanıt yok** | Öncesinde de hiç olmamış — kural muhtemelen ihtiyaten yazılmış |

İşaret yoksa döngü kapanmaz: kuralın işe yarayıp yaramadığı bir görüş meselesi olarak kalır.

## Gizlilik ve güvenlik

- Script **ağ çağrısı yapmaz** ve **repoya dosya yazmaz**. Taslak stdout'a gider; nereye
  ne gireceğine sen karar verirsin.
- `scar:write` skill'i de kendiliğinden `CLAUDE.md`'ye eklemez — metni gösterir ve onay ister.
- Okunamayan kayıt gizlenmez: kaç oturumun okunamadığı ve kaç düşük güvenli imzanın elendiği
  kaynak notunda yazar.

## Kurulum

```
# Claude Code içinde, bir kez marketplace ekle:
/plugin marketplace add halilneed/plugins
/plugin install scar@hailneed
```

Sonra dene:

```
/scar:mine
```

Gereksinim: Claude Code + Node.js 18+. Bağımlılık yok, API anahtarı yok.

## Plugin'siz kullanım

```
git clone https://github.com/halilneed/scar
cd scar

node scripts/scar.mjs --mine --md                 # tekrar eden hatalar
node scripts/scar.mjs --show <scar-id> --md       # tek yara izinin tüm epizotları
node scripts/scar.mjs --draft <scar-id>           # ders taslağı (dosya yazmaz)
node scripts/scar.mjs --verify --repo . --md      # ders tuttu mu?
node scripts/scar.mjs --selftest                  # kural öz-testi (ağ/disk yok)
```

Bayraklar: `--agent all|claude-code|codex|gemini-cli` · `--days N` · `--min-sessions N` ·
`--project X` · `--all` (düşük güvenli imzaları da göster) · `--lang tr|en` · `--out DOSYA`.

CI'da `--verify --out verify.json` çalıştırıp `written[].verdict` değerlerini kapıya
bağlayabilirsin; çıktı formatı sabittir ve `--selftest` ağ gerektirmez.

## Yol haritası (ve nasıl para kazanır)

- **v0.1 (bu repo):** 3 skill + bağımlılıksız tarayıcı + 16 hata ailesi, MIT.
- **v0.2:** kullanıcı düzeltmelerinden öğrenme (reddedilen çağrılardaki geri bildirim metni),
  `--since <tarih>` ile fark madenciliği, artefakt tarihinde dosya zamanı yerine git geçmişi,
  kural yerine hook önerisi, `--format sarif`.
- **Scar Cloud (ücretli, opsiyonel):** ekip genelinde yara izi havuzu — bir kişinin çarptığı
  duvar herkesin kuralına dönüşür; kural etkinliği zaman serisi; yeni gelen için "bu depoda
  bilinen tuzaklar" özeti. Plugin ücretsiz kalır.
  Bekleme listesi: https://halilneed.github.io/scar/#cloud

Bu depo `agentlens` ailesinin parçası: adaptör katmanı `agent-blackbox` ile paylaşılır,
kanonik kopya orada durur.

---

## English summary

**scar** turns recurring agent failures into lessons your repo remembers.

- **`/scar:mine`** — mines local session logs from Claude Code, Codex CLI and Gemini CLI for
  error patterns that repeat across **separate sessions**, ranked by what they actually cost
  (sessions × spread, not raw frequency), with the failing commands and what worked after.
- **`/scar:write`** — drafts the durable artifact: a rule, a regression-test brief, an
  environment fix or a decision record, each carrying an evidence line and a marker.
- **`/scar:verify`** — finds those markers, takes each file's date, and compares how often
  the failure occurred before and after. Four verdicts: held, recurred, too recent, no
  evidence. A rule that recurred is a finding about the rule.

**The tool-switch signal:** when most episodes end with a *different tool* succeeding right
after the failure, the lesson is not a better command but a better tool choice — and the
report says so.

**Nothing leaves your machine, and nothing is written into your repo.** No network calls, no
API key, no quota. The script drafts; you decide what lands. Node.js 18+, no dependencies.

```
/plugin marketplace add halilneed/plugins
/plugin install scar@hailneed
```

Or standalone: `node scripts/scar.mjs --mine --md --lang en`. MIT.
