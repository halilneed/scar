/**
 * scar — yara izini kalıcı bir artefakta çevirir
 *
 * TASARIM İLKESİ: Bu modül dosya YAZMAZ. Yalnızca taslak metin üretir; yazma kararı
 * her zaman kullanıcının ve `scar:write` skill'inindir.
 *
 * Üretilen her artefakt bir işaret taşır: `<!-- scar:<id> -->`. `scar --verify` bu
 * işareti arayıp dersin yazıldığı tarihten sonra hatanın tekrar edip etmediğini ölçer.
 * İşaret olmadan döngü kapanmaz — kuralın işe yarayıp yaramadığı bilinemez.
 */

export const MARKER = (id) => `<!-- scar:${id} -->`;
export const MARKER_RE = /<!--\s*scar:(scar-[a-z0-9]+)\s*-->/g;

const fmtDate = (iso) => (iso ? String(iso).slice(0, 10) : "?");

/** Yara izinin kanıt satırı — her artefaktın başına gider. */
export function evidenceLine(scar, { lang = "tr" } = {}) {
  const span = `${fmtDate(scar.firstAt)} → ${fmtDate(scar.lastAt)}`;
  return lang === "tr"
    ? `${scar.sessions} oturum · ${scar.projects.length} proje · ${scar.occurrences} kez · ${span}`
    : `${scar.sessions} sessions · ${scar.projects.length} projects · ${scar.occurrences} times · ${span}`;
}

/** En sık görülen ve gerçekten işe yaramış düzeltme (varsa). */
export function bestFix(scar) {
  const f = (scar.commonFixes || [])[0];
  return f && f.cmd ? f.cmd : null;
}

// ---------- artefakt taslakları ----------

const RULE_BODY = {
  "powershell-execution-policy": {
    tr: {
      rule: "PowerShell'i profil yüklemeden çağır: `powershell -NoProfile -ExecutionPolicy Bypass -File <betik>`.",
      note: "Kalıcı çözüm istiyorsan `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` bir kez çalıştırılır; ama bu makinenin genel güvenlik ayarını değiştirir, o yüzden kararı sen ver.",
    },
  },
  "not-a-git-repo": {
    tr: {
      rule: "git komutundan önce çalışma dizinini doğrula: `git rev-parse --is-inside-work-tree` ya da komutu `cd <depo> && ...` ile bağla.",
      note: "Bileşik komutlarda `cd` bir öncekinin dizinini taşımaz; her çağrıda dizini açıkça ver.",
    },
  },
  "git-identity": {
    tr: {
      rule: "Commit atarken kimliği komuta göm: `git -c user.name=\"<ad>\" -c user.email=\"<eposta>\" commit ...`.",
      note: "Global ayar yapmak yerine komut düzeyinde vermek, birden çok hesapla çalışırken yanlış kimlikle commit atmayı da engeller.",
    },
  },
  "shell-quoting": {
    tr: {
      rule: "Çok satırlı içeriği kabuğa heredoc ile gömme; dosyayı yazma aracıyla oluştur, kabuğa yalnızca kısa komut ver.",
      note: "Tırnak ve heredoc sınırlayıcıları araç katmanında bozulabiliyor; hata satır numarası verse de asıl sebep içeriğin kendisidir.",
    },
  },
  "edit-precondition": {
    tr: {
      rule: "Düzenlemeden önce dosyayı oku ve eşleştireceğin metni birebir (girinti dahil) kopyala; satır numarası ön ekini alma.",
      note: "Eşleşme bulunamadığında metni tahmin ederek yeniden deneme — dosyayı yeniden oku.",
    },
  },
  "command-not-found": {
    tr: {
      rule: "Aracın varlığını kullanmadan önce doğrula; yoksa kurulum adımını proje README'sine yaz.",
      note: "Eksik araç her yeni makinede tekrar eder; kurulumu belgelemek hatayı bir kez çözer.",
    },
  },
  "permission-or-lock": {
    tr: {
      rule: "Dosya kilidi veriyorsa önce onu tutan süreci kapat; build çıktısını çalışan uygulamanın kullandığı dizine yazma.",
      note: "Yönetici hakkı istemek yerine kilidin kaynağını bul — hak yükseltmek sorunu gizler.",
    },
  },
  "port-in-use": {
    tr: {
      rule: "Sunucuyu başlatmadan önce portu kontrol et ve gerekiyorsa sabit bir alternatif porta düş.",
      note: "Önceki oturumdan kalan süreç en sık sebeptir.",
    },
  },
  timeout: {
    tr: {
      rule: "Uzun süren komutu arka planda çalıştır ve tamamlanmasını ayrıca bekle; varsayılan zaman aşımına güvenme.",
      note: "Zaman aşımına uğrayan komut çoğu zaman gerçekten çalışmaya devam eder; iki kez başlatmamaya dikkat et.",
    },
  },
  auth: {
    tr: {
      rule: "Kimlik doğrulamasını iş başlamadan önce doğrula; hangi hesabın etkin olduğunu açıkça kontrol et.",
      note: "Birden çok hesap varsa yanlış olanın etkin olması en sık sebeptir.",
    },
  },
  "rate-limit": {
    tr: {
      rule: "Çağrılar arasına bekleme koy ve hız sınırına takıldığında yeniden denemeyi geriye doğru artan aralıkla yap.",
      note: "Sınır aşıldığında art arda denemek süreyi uzatır.",
    },
  },
  "module-not-found": {
    tr: {
      rule: "Komutu paket kökünden çalıştır ve bağımlılığın kurulu olduğunu doğrula.",
      note: "Yanlış çalışma dizini, eksik bağımlılıkla aynı hatayı verir; önce dizini kontrol et.",
    },
  },
  "file-not-found": {
    tr: {
      rule: "Yolu kullanmadan önce var olduğunu doğrula; göreli yolları çalışma dizinine göre değil, bilinen bir köke göre kur.",
      note: "Hata mesajındaki çalışma dizini satırı çoğu zaman gerçek sebebi söyler.",
    },
  },
};

/** Kural / karar artefaktı: repo içinde kalıcı bir talimat. */
export function draftRule(scar, { lang = "tr" } = {}) {
  const body = (RULE_BODY[scar.family] || {})[lang];
  const fix = bestFix(scar);
  const title = titleFor(scar);

  const lines = [
    MARKER(scar.id),
    `# ${title}`,
    "",
    `**Kanıt:** ${evidenceLine(scar, { lang })} · aile: \`${scar.family}\` · ajan: ${scar.agents.join(", ")}`,
    "",
    "## Ne oluyor",
    "",
    "```",
    scar.sample.slice(0, 200),
    "```",
    "",
    "## Kural",
    "",
    body ? `- ${body.rule}` : "- (Bu aile için hazır kural yok — dersi kendi cümlenle yaz.)",
    ...(body?.note ? ["", `> ${body.note}`] : []),
  ];

  if (scar.toolSwitch) {
    const ts = scar.toolSwitch;
    lines.push(
      "", "## Ne işe yaradı",
      "",
      `Hata **${ts.from}** aracında çıkıyor; ${ts.of} epizodun ${ts.n} tanesinde hemen sonrasında`,
      `işe yarayan araç **${ts.to}** oldu. Ders bir komut düzeltmesi değil, araç seçimi:`,
      `bu işi ${ts.from} ile yapma, ${ts.to} kullan.`,
    );
  } else if (fix) {
    lines.push("", "## Geçmişte işe yarayan", "", "```", fix.slice(0, 200), "```",
      "", "> Bu, hatadan sonra çalışan ve başarısız komutla ilişkili görünen ilk komuttur.");
  }

  lines.push(
    "",
    `**Görüldüğü projeler:** ${scar.projects.slice(0, 8).join(", ") || "—"}`,
    "",
  );
  return lines.join("\n");
}

/** Test artefaktı: hazır kod değil, ne doğrulanacağının özeti — testi repo kendi çatısıyla yazar. */
export function draftTestBrief(scar, { lang = "tr" } = {}) {
  return [
    MARKER(scar.id),
    `# Regresyon testi brifingi — ${titleFor(scar)}`,
    "",
    `**Kanıt:** ${evidenceLine(scar, { lang })}`,
    "",
    "## Yakalanacak hata",
    "",
    "```",
    scar.sample.slice(0, 200),
    "```",
    "",
    "## Testin doğrulaması gerekenler",
    "",
    "- Hatanın oluştuğu giriş/durum yeniden kurulur.",
    "- Beklenen sonuç, hata mesajının reddettiği şeydir; iddiayı hata metnine değil davranışa bağla.",
    "- Test, düzeltme geri alındığında **kırılmalı** — kırılmıyorsa hatayı yakalamıyordur.",
    "",
    "## Nereye",
    "",
    "- Deponun mevcut test çatısını kullan; yeni bir çatı ekleme.",
    "- Testi, hatanın çıktığı modülün yanındaki test dizinine koy.",
    "",
    `**Görüldüğü projeler:** ${scar.projects.slice(0, 8).join(", ") || "—"}`,
    "",
  ].join("\n");
}

/** Ortam artefaktı: bir kez yapılacak makine düzeltmesi. */
export function draftEnvironment(scar, { lang = "tr" } = {}) {
  const body = (RULE_BODY[scar.family] || {})[lang];
  return [
    MARKER(scar.id),
    `# Ortam düzeltmesi — ${titleFor(scar)}`,
    "",
    `**Kanıt:** ${evidenceLine(scar, { lang })}`,
    "",
    "## Hata",
    "",
    "```",
    scar.sample.slice(0, 200),
    "```",
    "",
    "## Kalıcı çözüm",
    "",
    body ? `- ${body.rule}` : "- (Bu aile için hazır düzeltme yok.)",
    ...(body?.note ? ["", `> ${body.note}`] : []),
    "",
    "> Ortam düzeltmesi makineyi değiştirir. Uygulamadan önce ne yaptığını oku; geri alma",
    "> adımını da not düş.",
    "",
  ].join("\n");
}

export function draft(scar, opts = {}) {
  switch (scar.artifact) {
    case "test": return draftTestBrief(scar, opts);
    case "environment": return draftEnvironment(scar, opts);
    default: return draftRule(scar, opts);
  }
}

function titleFor(scar) {
  const s = scar.sample.replace(/\s+/g, " ").trim();
  return s.length > 70 ? s.slice(0, 70) + "…" : s;
}

// ---------- döngü kapanışı: yazıldı mı, işe yaradı mı ----------

/**
 * Bir metin gövdesinde hangi scar işaretlerinin geçtiğini bulur.
 * (Dosyaları okumak çağıranın işi; bu modül dosya sistemine dokunmaz.)
 */
export function findMarkers(text) {
  const out = new Set();
  MARKER_RE.lastIndex = 0;
  let m;
  while ((m = MARKER_RE.exec(String(text || "")))) out.add(m[1]);
  return [...out];
}

/**
 * Ders yazıldıktan sonra hata tekrar etti mi?
 * `writtenAt` artefaktın tarihi; epizotlar o tarihten önce/sonra sayılır.
 */
export function measureEffect(scar, writtenAt, { now = Date.now(), minDays = 7 } = {}) {
  const cut = new Date(writtenAt).getTime();
  let before = 0, after = 0, lastAfter = null;
  for (const ep of scar.episodes || []) {
    if (!ep.ts) continue;
    const t = new Date(ep.ts).getTime();
    if (t < cut) before++;
    else { after++; if (!lastAfter || ep.ts > lastAfter) lastAfter = ep.ts; }
  }
  const ageDays = (now - cut) / 86400000;
  // Yeni yazılmış bir kural için "tuttu" demek erken: hata henüz tekrar etme fırsatı bulmadı.
  const verdict = after > 0 ? "tekrar-etti"
    : before === 0 ? "kanit-yok"
    : ageDays < minDays ? "cok-yeni"
    : "tuttu";
  return { writtenAt, before, after, lastAfter, ageDays: Math.round(ageDays), verdict };
}

// ---------- öz-test ----------

export function selftest() {
  const fails = [];
  const scar = {
    id: "scar-abc1234", family: "not-a-git-repo", artifact: "rule",
    sample: "fatal: not a git repository (or any of the parent directories): .git",
    occurrences: 9, sessions: 7, projects: ["a", "b"], agents: ["codex"],
    firstAt: "2026-03-01T00:00:00Z", lastAt: "2026-08-01T00:00:00Z",
    commonFixes: [{ cmd: "cd repo && git status", n: 3 }],
    episodes: [
      { ts: "2026-03-01T00:00:00Z" }, { ts: "2026-05-01T00:00:00Z" }, { ts: "2026-08-01T00:00:00Z" },
    ],
  };

  const rule = draft(scar);
  if (!rule.includes("<!-- scar:scar-abc1234 -->")) fails.push("kural taslağı işaret taşımıyor");
  if (!rule.includes("cd repo && git status")) fails.push("kural taslağı bilinen düzeltmeyi taşımıyor");
  const sw = draft({ ...scar, commonFixes: [], toolSwitch: { from: "Bash", to: "Write", n: 9, of: 10 } });
  if (!/Bash ile yapma, Write kullan/.test(sw)) fails.push("araç değişimi dersi taslağa girmedi");
  if (!rule.includes("7 oturum")) fails.push("kural taslağı kanıt satırı taşımıyor");

  const test = draft({ ...scar, artifact: "test" });
  if (!/Regresyon testi brifingi/.test(test)) fails.push("test brifingi üretilmedi");
  const env = draft({ ...scar, artifact: "environment", family: "powershell-execution-policy" });
  if (!/-NoProfile/.test(env)) fails.push("ortam düzeltmesi hazır çözümü taşımıyor");

  const found = findMarkers(`bir şeyler\n${MARKER("scar-abc1234")}\nbaşka şeyler ${MARKER("scar-zz9")}`);
  if (found.length !== 2 || !found.includes("scar-abc1234")) fails.push("işaret bulma çalışmıyor");
  if (findMarkers("işaretsiz metin").length) fails.push("işaretsiz metinde işaret bulundu");

  const eff = measureEffect(scar, "2026-06-01T00:00:00Z");
  if (eff.before !== 2 || eff.after !== 1) fails.push(`etki ölçümü yanlış: ${eff.before}/${eff.after}`);
  if (eff.verdict !== "tekrar-etti") fails.push("etki hükmü yanlış");
  const eff2 = measureEffect(scar, "2026-09-01T00:00:00Z", { now: new Date("2026-12-01T00:00:00Z").getTime() });
  if (eff2.verdict !== "tuttu") fails.push("hata durduğunda hüküm 'tuttu' olmalı");
  const eff3 = measureEffect(scar, "2026-09-01T00:00:00Z", { now: new Date("2026-09-02T00:00:00Z").getTime() });
  if (eff3.verdict !== "cok-yeni") fails.push("yeni yazılmış kural için hüküm 'cok-yeni' olmalı");

  return { total: 12, fails };
}
