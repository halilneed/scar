/**
 * scar — hata epizodu çıkarımı, imzalama ve düzeltme farkı
 *
 * TASARIM İLKESİ: Ağ çağrısı yok. Sadece yerel oturum kayıtları okunur.
 * Bir yara izi ancak **tekrar ettiğinde** yara izidir: tek seferlik hata gürültüdür,
 * birden çok oturumda tekrar eden hata kalıcı bir derse dönüşmeyi hak eder.
 *
 * Epizot: bir ya da daha çok ardışık başarısız araç sonucu, ardından (varsa) aynı
 * ailedeki ilk başarılı çağrı. Bu ikisi arasındaki fark **düzeltmedir** — dersin kendisi.
 */

import { basename } from "node:path";

// ---------- hata satırı çıkarımı ----------

/**
 * Ajanın kendi sarmalayıcı satırları; asıl hata bunların altındadır.
 * İlk kalıp değer taşıyan sarmalayıcılar ("Exit code: 1"), ikincisi yalnız başlıklar
 * ("Output:"). `Error:` tek başınayken başlıktır ama "Error: ENOENT…" gerçek hatadır.
 */
const WRAPPER_RE = /^(?:exit code|wall time|total output lines|script (?:completed|failed|error)|warning: truncated)[^\n]*$|^(?:output|stdout|stderr|error)\s*:?\s*$/i;

/** Hata gibi okunan satır. */
const ERRORISH_RE = /error|fail|fatal|cannot|can'?t\b|not found|denied|refused|invalid|unexpected|exception|no such|missing|unable|traceback|not recognized|is not a|already in use|timed out|<tool_use_error>/i;

/** Yalnızca konum bildiren, mesaj taşımayan satırlar. */
const POSITION_RE = /^(?:at line:\d+ char:\d+|\s*[+~^]+\s*|\s*\|+\s*|file "[^"]+", line \d+.*|\s{4,}at\s)/i;

/**
 * Ham hata metninden anlamlı tek satırı çıkarır.
 * Python geri izlemelerinde son satır, PowerShell'de konum satırları atlanarak ilk mesaj.
 */
export function errorLine(text) {
  return pickErrorLine(text).line;
}

/**
 * Hata satırını **ve** ona ne kadar güvendiğimizi döner.
 * Hiçbir satır hataya benzemiyorsa ilk satır alınır ama `confident: false` işaretlenir —
 * böyle epizotlar genelde hata değil, çıkış kodu sıfırdan farklı olan sıradan çıktıdır.
 */
export function pickErrorLine(text) {
  const lines = String(text || "")
    .split("\n")
    .map((l) => l.replace(/\r$/, "").trim())
    .filter((l) => l && !WRAPPER_RE.test(l) && !POSITION_RE.test(l));
  if (!lines.length) return { line: "", confident: false };

  // Python geri izlemesi: asıl hata en sondadır
  const tb = lines.findIndex((l) => /^traceback \(most recent call last\)/i.test(l));
  if (tb > -1) {
    for (let i = lines.length - 1; i > tb; i--) {
      if (/^\w[\w.]*(?:Error|Exception|Warning)\b/.test(lines[i])) return { line: lines[i], confident: true };
    }
    return { line: lines[lines.length - 1], confident: true };
  }

  const errish = lines.find((l) => ERRORISH_RE.test(l));
  return errish ? { line: errish, confident: true } : { line: lines[0], confident: false };
}

/** Yolları, sayıları ve hash'leri sabitleyip oturumlar arası karşılaştırılabilir imza üretir. */
export function signature(line) {
  return String(line || "")
    .toLowerCase()
    .replace(/[a-z]:[\\/][^\s"':,]+/g, "<yol>")
    .replace(/(^|[\s"'(])\/[\w./-]{6,}/g, "$1<yol>")
    .replace(/\b[0-9a-f]{7,}\b/g, "<hash>")
    .replace(/\b\d+(?:\.\d+)?\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

// ---------- hata ailesi ----------

/**
 * Aile, dersin **hangi biçimde** yazılacağını belirler:
 * kural mı, test mi, izin girdisi mi, ortam düzeltmesi mi.
 */
export const FAMILIES = [
  { id: "powershell-execution-policy", re: /cannot be loaded because running scripts is disabled|execution.?polic/i,
    artifact: "environment", why: "PowerShell betik çalıştırmayı engelliyor; her yeni kabukta tekrar eder." },
  { id: "not-a-git-repo", re: /not a git repository/i,
    artifact: "rule", why: "Komut yanlış çalışma dizininde çalıştırıldı." },
  { id: "git-identity", re: /author identity unknown|please tell me who you are/i,
    artifact: "environment", why: "git kullanıcı adı/e-postası ayarlı değil." },
  { id: "shell-quoting", re: /unexpected eof while looking for matching|unterminated quoted string|unexpected token/i,
    artifact: "rule", why: "Kabuk alıntılama/heredoc kalıbı bu araçta bozuluyor." },
  { id: "edit-precondition", re: /<tool_use_error>|string to replace not found|has not been read yet/i,
    artifact: "rule", why: "Araç sözleşmesi ihlal edildi (önce oku, birebir eşleştir)." },
  { id: "command-not-found", re: /command not found|is not recognized as|no such command|^\W*[\w.+-]{2,24} not found/i,
    artifact: "environment", why: "Araç kurulu değil ya da PATH'te yok." },
  { id: "module-not-found", re: /cannot find module|module_not_found|no module named|importerror/i,
    artifact: "rule", why: "Bağımlılık eksik ya da yanlış çalışma dizininden çağrılıyor." },
  { id: "file-not-found", re: /no such file or directory|cannot find path|enoent|file does not exist/i,
    artifact: "rule", why: "Yol yanlış ya da dosya beklenen yerde değil." },
  { id: "permission-or-lock", re: /permission denied|access (?:is )?denied|eacces|eperm|being used by another process/i,
    artifact: "rule", why: "Dosya kilitli ya da izin yetersiz — çalışan bir süreç olabilir." },
  { id: "port-in-use", re: /eaddrinuse|address already in use|port \d+ .*in use/i,
    artifact: "rule", why: "Aynı port başka bir süreç tarafından tutuluyor." },
  { id: "auth", re: /\b(?:401|403)\b|unauthorized|forbidden|authentication failed|bad credentials/i,
    artifact: "environment", why: "Kimlik doğrulama başarısız — anahtar ya da hesap yanlış." },
  { id: "rate-limit", re: /\b429\b|rate limit|too many requests|quota exceeded/i,
    artifact: "rule", why: "Servis hız sınırına takılıyor." },
  { id: "timeout", re: /timed out|etimedout|deadline exceeded/i,
    artifact: "rule", why: "İşlem verilen sürede bitmedi." },
  { id: "test-failure", re: /\d+ (?:test|assertion)s? failed|assertionerror|expected .* but (?:got|was)/i,
    artifact: "test", why: "Davranış hatası — bir regresyon testi bunu yakalardı." },
  { id: "compile-error", re: /error [A-Z]{2}\d{4}|syntaxerror|compilation failed|build failed|cannot implicitly convert|type '.*' is not assignable/i,
    artifact: "test", why: "Derleme kırıldı — build kapısı bunu erken yakalar." },
  { id: "feature-unavailable", re: /early access|not enabled for|requires a subscription|is not available on your plan/i,
    artifact: "decision", why: "Özellik bu hesapta kapalı; her denemede aynı duvara çarpılıyor." },
];

export function familyOf(line) {
  return (FAMILIES.find((f) => f.re.test(line)) || { id: "other", artifact: "rule", why: "Sınıflandırılmamış tekrar eden hata." });
}

// ---------- epizot çıkarımı ----------

const SAME_FAMILY = (a, b) => a && b && a === b;

const head = (cmd) => String(cmd || "").trim().split(/[\s;|&]+/).find((x) => x && !/^(cd|sudo)$/i.test(x)) || "";

/**
 * Hatadan sonra çalışan ilk komut, düzeltme OLMAYABİLİR — sıradaki iş de olabilir.
 * Aynı aracı çağırıyorsa ya da kelimelerin belirgin bir kısmı ortaksa düzeltme sayılır;
 * aksi hâlde kaydedilir ama "güvenilir düzeltme" olarak raporlanmaz.
 */
function fixLooksRelated(failing, fix) {
  if (!failing || !fix) return false;
  if (head(failing) && head(failing) === head(fix)) return true;
  const tok = (s) => new Set(String(s).toLowerCase().match(/[\w.-]{3,}/g) || []);
  const a = tok(failing), b = tok(fix);
  if (!a.size || !b.size) return false;
  let shared = 0;
  for (const x of a) if (b.has(x)) shared++;
  return shared / Math.min(a.size, b.size) >= 0.4;
}

/**
 * Bir oturumdaki hata epizotlarını çıkarır.
 * Her epizot: kaç ardışık başarısızlık, hata satırı, başarısız komut ve —
 * varsa — sonrasında işe yarayan komut (düzeltme).
 */
export function extractEpisodes(session) {
  const evs = session.events;
  const callById = new Map();
  for (const e of evs) if (e.kind === "call" && e.callId) callById.set(e.callId, e);

  const out = [];
  for (let i = 0; i < evs.length; i++) {
    const e = evs[i];
    if (e.kind !== "result" || e.ok !== false) continue;

    let failures = 1;
    let j = i + 1;
    while (j < evs.length && (evs[j].kind !== "result" || evs[j].ok === false)) {
      if (evs[j].kind === "result") failures++;
      j++;
    }

    const { line, confident } = pickErrorLine(e.text);
    if (!line) { i = j; continue; }

    const failingCall = e.callId ? callById.get(e.callId) : null;
    // Düzeltme: aynı ailedeki ilk başarılı sonuç ve onu üreten çağrı
    let fixCall = null;
    for (let k = j; k < evs.length && k < j + 40; k++) {
      const r = evs[k];
      if (r.kind !== "result" || r.ok !== true) continue;
      if (!SAME_FAMILY(r.family, e.family)) continue;
      fixCall = r.callId ? callById.get(r.callId) : null;
      break;
    }

    // Bazen düzeltme bir komut değil, ARAÇ DEĞİŞİMİdir (heredoc yerine yazma aracı gibi).
    // Bu yüzden aileden bağımsız olarak sonraki başarılı çağrının aracı da kaydedilir.
    let nextTool = null;
    for (let k = j; k < evs.length && k < j + 20; k++) {
      const r = evs[k];
      if (r.kind === "result" && r.ok === true) { nextTool = r.tool || null; break; }
    }

    const fam = familyOf(line);
    out.push({
      sessionId: session.id,
      agent: session.agent,
      project: session.cwd ? basename(session.cwd) : null,
      cwd: session.cwd || null,
      ts: e.ts,
      seq: e.seq,
      tool: e.tool || (failingCall && failingCall.tool) || null,
      toolFamily: e.family,
      failures,
      errorLine: line.slice(0, 220),
      confident,
      sig: signature(line),
      family: fam.id,
      artifact: fam.artifact,
      failingCommand: failingCall ? (failingCall.command || failingCall.text || "").slice(0, 220) : null,
      fixCommand: fixCall ? (fixCall.command || fixCall.text || "").slice(0, 220) : null,
      fixRelated: fixCall ? fixLooksRelated(failingCall && (failingCall.command || failingCall.text), fixCall.command || fixCall.text) : false,
      nextTool,
      resolved: !!fixCall,
    });
    i = j;
  }
  return out;
}

// ---------- yara izi toplama ----------

/**
 * Epizotları imzaya göre gruplar. `minSessions` eşiği altındakiler yara izi sayılmaz:
 * bir kez olan hata olaydır, tekrar eden hata desendir.
 */
export function groupScars(episodes, { minSessions = 2, includeLowConfidence = false } = {}) {
  const map = new Map();
  for (const ep of episodes) {
    if (!includeLowConfidence && ep.confident === false) continue;
    const g = map.get(ep.sig) || {
      sig: ep.sig, family: ep.family, artifact: ep.artifact,
      sample: ep.errorLine, occurrences: 0, maxStreak: 0, resolvedCount: 0,
      sessions: new Set(), projects: new Set(), agents: new Set(),
      firstAt: null, lastAt: null, fixes: new Map(), episodes: [],
      failTools: new Map(), nextTools: new Map(),
    };
    g.occurrences++;
    g.maxStreak = Math.max(g.maxStreak, ep.failures);
    if (ep.resolved) g.resolvedCount++;
    g.sessions.add(ep.sessionId);
    if (ep.project) g.projects.add(ep.project);
    g.agents.add(ep.agent);
    if (ep.ts) {
      if (!g.firstAt || ep.ts < g.firstAt) g.firstAt = ep.ts;
      if (!g.lastAt || ep.ts > g.lastAt) g.lastAt = ep.ts;
    }
    // Yalnızca başarısız komutla ilişkili görünen düzeltmeler sayılır.
    if (ep.fixCommand && ep.fixRelated) g.fixes.set(ep.fixCommand, (g.fixes.get(ep.fixCommand) || 0) + 1);
    if (ep.tool) g.failTools.set(ep.tool, (g.failTools.get(ep.tool) || 0) + 1);
    if (ep.nextTool) g.nextTools.set(ep.nextTool, (g.nextTools.get(ep.nextTool) || 0) + 1);
    if (g.episodes.length < 12) g.episodes.push(ep);
    map.set(ep.sig, g);
  }

  return [...map.values()]
    .filter((g) => g.sessions.size >= minSessions)
    .map((g) => ({
      id: scarId(g.sig),
      sig: g.sig, family: g.family, artifact: g.artifact, sample: g.sample,
      occurrences: g.occurrences, sessions: g.sessions.size,
      projects: [...g.projects], agents: [...g.agents],
      maxStreak: g.maxStreak, resolvedCount: g.resolvedCount,
      firstAt: g.firstAt, lastAt: g.lastAt,
      commonFixes: [...g.fixes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([cmd, n]) => ({ cmd, n })),
      toolSwitch: dominantSwitch(g),
      cost: cost(g),
      episodes: g.episodes,
    }))
    .sort((a, b) => b.cost - a.cost);
}

/**
 * Hatanın çıktığı araçla, hemen sonrasında işe yarayan araç farklıysa ders budur:
 * "bu işi o araçla yapma, şununla yap". Yarıdan fazla epizotta aynı geçiş görülmeli.
 */
function dominantSwitch(g) {
  const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])[0];
  const from = top(g.failTools), to = top(g.nextTools);
  if (!from || !to || from[0] === to[0]) return null;
  if (to[1] / Math.max(1, g.occurrences) < 0.5) return null;
  return { from: from[0], to: to[0], n: to[1], of: g.occurrences };
}

/**
 * Maliyet = kaç ayrı oturumu böldü × yayılım. Ham tekrar sayısı değil, çünkü tek bir
 * oturumdaki 20 deneme bir kez öğrenilecek bir derstir; 8 ayrı oturum sekiz kez unutulmuş.
 */
function cost(g) {
  return g.sessions.size * 3 + g.projects.size * 2 + Math.min(g.occurrences, 30) + (g.agents.size > 1 ? 4 : 0);
}

/** İmzadan kısa, kararlı bir kimlik. */
export function scarId(sig) {
  let h = 0x811c9dc5;
  for (let i = 0; i < sig.length; i++) h = Math.imul(h ^ sig.charCodeAt(i), 16777619) >>> 0;
  return "scar-" + h.toString(36).padStart(7, "0").slice(-7);
}

// ---------- öz-test (ağ yok, disk yok) ----------

const T = (name, fn) => [name, fn];

export function selftest() {
  const fails = [];
  const cases = [
    T("codex sarmalayıcısı ayıklanır", () =>
      errorLine("Exit code: 1\nWall time: 0.4 seconds\nOutput:\nfatal: not a git repository") === "fatal: not a git repository"),
    T("python geri izlemesinde son hata alınır", () =>
      errorLine("Traceback (most recent call last):\n  File \"a.py\", line 3, in <module>\n    x()\nNameError: name 'x' is not defined")
        === "NameError: name 'x' is not defined"),
    T("powershell konum satırı atlanır", () =>
      errorLine("At line:4 char:28\n+ foo bar\n+     ~~~\nThe term 'foo' is not recognized as a name of a cmdlet")
        === "The term 'foo' is not recognized as a name of a cmdlet"),
    T("boş metin boş döner", () => errorLine("Exit code: 0\nOutput:\n") === ""),
    T("imza yolları sabitler", () =>
      signature("cannot open C:\\Users\\pc\\a.txt at line 42") === signature("cannot open C:\\Users\\ali\\b.txt at line 7")),
    T("imza farklı hataları ayırır", () =>
      signature("fatal: not a git repository") !== signature("fatal: authentication failed")),
    T("aile: execution policy", () => familyOf("File profile.ps1 cannot be loaded because running scripts is disabled").id === "powershell-execution-policy"),
    T("aile: git deposu değil", () => familyOf("fatal: not a git repository (or any of the parent directories)").id === "not-a-git-repo"),
    T("aile: kabuk alıntılama", () => familyOf("bash: -c: line 105: unexpected EOF while looking for matching `'").id === "shell-quoting"),
    T("aile: araç sözleşmesi", () => familyOf("<tool_use_error>String to replace not found in file.").id === "edit-precondition"),
    T("aile: derleme hatası test artefaktı ister", () => familyOf("error CS1002: ; expected").artifact === "test"),
    T("bilinmeyen hata other olur", () => familyOf("something odd happened").id === "other"),
  ];
  for (const [name, fn] of cases) {
    let ok = false;
    try { ok = fn(); } catch (e) { fails.push(`${name}: hata — ${e.message}`); continue; }
    if (!ok) fails.push(`başarısız: ${name}`);
  }

  // epizot çıkarımı
  const session = {
    id: "s1", agent: "test", cwd: "C:/p",
    events: [
      { seq: 0, kind: "call", callId: "a", tool: "Bash", family: "shell", command: "git status" },
      { seq: 1, kind: "result", callId: "a", tool: "Bash", family: "shell", ok: false, ts: "2026-01-01T00:00:00Z", text: "fatal: not a git repository" },
      { seq: 2, kind: "call", callId: "b", tool: "Bash", family: "shell", command: "cd repo && git status" },
      { seq: 3, kind: "result", callId: "b", tool: "Bash", family: "shell", ok: true, ts: "2026-01-01T00:01:00Z", text: "clean" },
    ],
  };
  const eps = extractEpisodes(session);
  if (eps.length !== 1) fails.push(`epizot sayısı 1 olmalıydı, ${eps.length} bulundu`);
  else {
    if (eps[0].family !== "not-a-git-repo") fails.push("epizot ailesi yanlış");
    if (!eps[0].resolved) fails.push("epizot çözülmüş sayılmadı");
    if (eps[0].fixCommand !== "cd repo && git status") fails.push("düzeltme komutu yakalanmadı");
    if (!eps[0].fixRelated) fails.push("ilişkili düzeltme ilişkisiz sayıldı");
    if (eps[0].failingCommand !== "git status") fails.push("başarısız komut yakalanmadı");
  }

  // gruplama eşiği
  const one = groupScars(eps, { minSessions: 2 });
  if (one.length !== 0) fails.push("tek oturumda görülen hata yara izi sayıldı");
  const two = groupScars([...eps, { ...eps[0], sessionId: "s2" }], { minSessions: 2 });
  if (two.length !== 1) fails.push("iki oturumda tekrar eden hata yara izi sayılmadı");
  else if (two[0].sessions !== 2) fails.push("oturum sayısı yanlış");
  if (scarId("a") !== scarId("a") || scarId("a") === scarId("b")) fails.push("scar kimliği kararlı/ayırt edici değil");

  // alakasız bir sonraki komut düzeltme sayılmamalı
  const unrelated = extractEpisodes({
    id: "s3", agent: "test", cwd: "C:/p",
    events: [
      { seq: 0, kind: "call", callId: "a", tool: "Bash", family: "shell", command: "cat > a.txt <<'EOF'" },
      { seq: 1, kind: "result", callId: "a", tool: "Bash", family: "shell", ok: false, ts: "2026-01-01T00:00:00Z", text: "unexpected EOF while looking for matching" },
      { seq: 2, kind: "call", callId: "b", tool: "Bash", family: "shell", command: "npm run build" },
      { seq: 3, kind: "result", callId: "b", tool: "Bash", family: "shell", ok: true, ts: "2026-01-01T00:01:00Z", text: "done" },
    ],
  });
  if (unrelated[0]?.fixRelated) fails.push("alakasız komut düzeltme sayıldı");
  if (unrelated[0]?.nextTool !== "Bash") fails.push("sonraki başarılı araç kaydedilmedi");

  // araç değişimi: Bash başarısız, Write başarılı
  const switched = extractEpisodes({
    id: "s5", agent: "test", cwd: "C:/p",
    events: [
      { seq: 0, kind: "call", callId: "a", tool: "Bash", family: "shell", command: "cat > a.txt <<'EOF'" },
      { seq: 1, kind: "result", callId: "a", tool: "Bash", family: "shell", ok: false, ts: "2026-01-01T00:00:00Z", text: "unexpected EOF while looking for matching" },
      { seq: 2, kind: "call", callId: "b", tool: "Write", family: "edit", paths: ["a.txt"] },
      { seq: 3, kind: "result", callId: "b", tool: "Write", family: "edit", ok: true, ts: "2026-01-01T00:01:00Z", text: "ok" },
    ],
  });
  const sw = groupScars([switched[0], { ...switched[0], sessionId: "s6" }], { minSessions: 2 })[0];
  if (!sw?.toolSwitch || sw.toolSwitch.from !== "Bash" || sw.toolSwitch.to !== "Write")
    fails.push("baskın araç değişimi yakalanmadı");
  if (groupScars([unrelated[0], { ...unrelated[0], sessionId: "s4" }], { minSessions: 2 })[0].commonFixes.length)
    fails.push("alakasız düzeltme commonFixes'e girdi");

  return { total: cases.length + 13, fails };
}
