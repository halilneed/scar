#!/usr/bin/env node
/**
 * scar — tekrar eden ajan hatalarını kalıcı derse çevirir.
 *
 * blackbox "ne yanlış gitti" der. scar "bir daha olmasın" yazar ve sonra
 * **işe yarayıp yaramadığını ölçer**.
 *
 * Üç adım:
 *   1. --mine    yerel oturum kayıtlarından tekrar eden hata desenlerini çıkar
 *   2. --draft   seçilen yara izi için kural / test brifingi / ortam düzeltmesi taslağı üret
 *   3. --verify  yazılmış dersten sonra hata gerçekten durdu mu, ölç
 *
 * TASARIM İLKESİ: Ağ çağrısı yok, kota harcanmaz, DOSYA YAZILMAZ. Taslak stdout'a
 * (ya da --out ile belirttiğin dosyaya) gider; repoya ne gireceğine sen karar verirsin.
 *
 * Kullanım:
 *   node scar.mjs --mine [--days 90] [--min-sessions 2] [--project X] [--md]
 *   node scar.mjs --show <scar-id>
 *   node scar.mjs --draft <scar-id> [--out kural.md]
 *   node scar.mjs --verify [--repo .] [--md]
 *   node scar.mjs --selftest
 *
 * Bayraklar: --agent all|claude-code|codex|gemini-cli · --lang tr|en · --all
 *            --limit N · --out DOSYA
 * Gereksinim: Node.js 18+. Bağımlılık yok.
 */

import { writeFileSync, mkdirSync, readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, resolve, join, basename } from "node:path";
import { homedir } from "node:os";

import { listAllSessions, getAdapter } from "./lib/adapters.mjs";
import { extractEpisodes, groupScars, selftest as scarsSelftest, FAMILIES } from "./lib/scars.mjs";
import { draft, findMarkers, measureEffect, selftest as artifactsSelftest } from "./lib/artifacts.mjs";

// ---------- argümanlar ----------
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, fb = null) => { const i = argv.indexOf(n); return i > -1 && argv[i + 1] !== undefined ? argv[i + 1] : fb; };

const AGENT = opt("--agent", "all");
const DAYS = parseInt(opt("--days", "0"), 10) || 0;
const MIN_SESSIONS = Math.max(1, parseInt(opt("--min-sessions", "2"), 10) || 2);
const PROJECT = opt("--project");
const REPO = opt("--repo", ".");
const LIMIT = Math.max(1, parseInt(opt("--limit", "30"), 10) || 30);
const LANG = opt("--lang", "tr") === "en" ? "en" : "tr";
const OUT = opt("--out");
const ALL = flag("--all");
const MD = flag("--md");

const tr = LANG === "tr";
const t = (a, b) => (tr ? a : b);

// ---------- yardımcılar ----------
const outDir = () => resolve(homedir(), ".agentlens", "scar");

function emit(obj, md) {
  const text = MD ? md : JSON.stringify(obj, null, 2);
  if (OUT) {
    const target = resolve(OUT);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text, "utf8");
    process.stdout.write(`${t("yazıldı", "written")}: ${target}\n`);
  } else {
    process.stdout.write(text + "\n");
  }
}

const short = (s, n = 70) => {
  const x = String(s ?? "").replace(/\s+/g, " ").trim();
  return x.length > n ? x.slice(0, n) + "…" : x;
};
const cell = (s, n = 80) => short(s, n).replace(/\|/g, "\\|");
const day = (iso) => (iso ? String(iso).slice(0, 10) : "?");

/** Tüm oturumları tarayıp yara izlerini çıkarır. */
function mine() {
  const metas = listAllSessions({ agent: AGENT, days: DAYS });
  const episodes = [];
  let scanned = 0, unreadable = 0;
  for (const m of metas) {
    let s;
    try { s = getAdapter(m.agent).loadSession(m.file); } catch { unreadable++; continue; }
    scanned++;
    if (PROJECT && !(s.cwd || "").toLowerCase().includes(PROJECT.toLowerCase())) continue;
    episodes.push(...extractEpisodes(s));
  }
  const scars = groupScars(episodes, { minSessions: MIN_SESSIONS, includeLowConfidence: ALL });
  const withLow = ALL ? scars : groupScars(episodes, { minSessions: MIN_SESSIONS, includeLowConfidence: true });
  return {
    window: {
      agent: AGENT, days: DAYS, project: PROJECT || null,
      sessionsScanned: scanned, unreadable,
      episodes: episodes.length,
      lowConfidenceDropped: ALL ? 0 : withLow.length - scars.length,
    },
    scars,
  };
}

function sourceLine(w) {
  return [
    `${w.sessionsScanned} ${t("oturum tarandı", "sessions scanned")} (${w.agent}${w.days ? `, ${w.days}${t("g", "d")}` : ""})`,
    `${w.episodes} ${t("hata epizodu", "failure episodes")}`,
    w.unreadable ? `${w.unreadable} ${t("okunamadı", "unreadable")}` : null,
    w.lowConfidenceDropped ? `${w.lowConfidenceDropped} ${t("düşük güvenli imza elendi", "low-confidence signatures dropped")}` : null,
  ].filter(Boolean).join(" · ");
}

// ---------- komut: --mine ----------

function cmdMine() {
  const { window: w, scars } = mine();
  const shown = scars.slice(0, LIMIT);

  const md = [
    `# scar — ${t("tekrar eden hatalar", "recurring failures")}`, "",
    `**${t("Kaynak notu", "Source note")}:** ${sourceLine(w)} · ${scars.length} ${t("yara izi", "scars")}`,
    "",
    `> ${t(
      "Bir hata ancak **birden çok oturumda** tekrar ettiğinde yara izi sayılır. Tek oturumda 20 kez denenmiş bir hata bir kez öğrenilecek derstir; 8 ayrı oturumda tekrar eden hata sekiz kez unutulmuştur.",
      "A failure counts as a scar only when it recurs across **separate sessions**. Twenty attempts inside one session is one lesson; the same failure in eight sessions was forgotten eight times."
    )}`,
    "",
    ...(shown.length ? [
      `| ${t("Kimlik", "Id")} | ${t("maliyet", "cost")} | ${t("oturum", "sessions")} | ${t("proje", "projects")} | ${t("aile", "family")} | ${t("artefakt", "artifact")} | ${t("hata", "error")} |`,
      "|---|---|---|---|---|---|---|",
      ...shown.map((s) => `| \`${s.id}\` | ${s.cost} | ${s.sessions} | ${s.projects.length} | ${s.family} | ${s.artifact} | ${cell(s.sample, 60)} |`),
      "",
      `## ${t("Ne yapmalı", "What to do")}`, "",
      ...shown.slice(0, 6).map((s) =>
        `- **${s.id}** (${s.sessions} ${t("oturum", "sessions")}, ${day(s.firstAt)}→${day(s.lastAt)}) — ${familyWhy(s.family)}\n  ` +
        `\`node scar.mjs --draft ${s.id}\` → ${artifactLabel(s.artifact)}`),
    ] : [t("Eşiği geçen tekrar eden hata yok.", "No recurring failure above the threshold.")]),
    "",
  ].join("\n");

  emit({ kind: "mine", generatedAt: new Date().toISOString(), window: w, scars: shown.map(slim) }, md);
}

const slim = (s) => ({
  id: s.id, family: s.family, artifact: s.artifact, sample: s.sample,
  cost: s.cost, occurrences: s.occurrences, sessions: s.sessions,
  projects: s.projects, agents: s.agents, maxStreak: s.maxStreak,
  resolvedCount: s.resolvedCount, firstAt: s.firstAt, lastAt: s.lastAt,
  commonFixes: s.commonFixes,
});

const familyWhy = (id) => (FAMILIES.find((f) => f.id === id) || { why: t("Sınıflandırılmamış tekrar eden hata.", "Unclassified recurring failure.") }).why;
const artifactLabel = (a) => ({
  rule: t("kural", "rule"), test: t("regresyon testi brifingi", "regression test brief"),
  environment: t("ortam düzeltmesi", "environment fix"), decision: t("karar kaydı", "decision record"),
}[a] || a);

// ---------- komut: --show ----------

function cmdShow(id) {
  const { window: w, scars } = mine();
  const s = scars.find((x) => x.id === id || x.id.endsWith(id));
  if (!s) return notFound(id);

  const md = [
    `# ${s.id} — ${cell(s.sample, 90)}`, "",
    `**${t("Kaynak notu", "Source note")}:** ${sourceLine(w)}`,
    `**${t("Aile", "Family")}:** \`${s.family}\` → ${artifactLabel(s.artifact)} · **${t("maliyet", "cost")}:** ${s.cost}`,
    `**${t("Yayılım", "Spread")}:** ${s.sessions} ${t("oturum", "sessions")} · ${s.projects.length} ${t("proje", "projects")} (${s.projects.join(", ")}) · ${s.agents.join(", ")}`,
    `**${t("Zaman", "Window")}:** ${day(s.firstAt)} → ${day(s.lastAt)} · ${s.occurrences} ${t("kez", "times")} · ${t("en uzun seri", "longest streak")}: ${s.maxStreak}`,
    "",
    `## ${t("Hata", "Error")}`, "", "```", s.sample, "```", "",
    `## ${t("Görülen epizotlar", "Episodes")}`, "",
    `| ${t("tarih", "date")} | ${t("proje", "project")} | ${t("ajan", "agent")} | ${t("deneme", "tries")} | ${t("başarısız komut", "failing command")} |`,
    "|---|---|---|---|---|",
    ...s.episodes.map((e) => `| ${day(e.ts)} | ${e.project || "—"} | ${e.agent} | ${e.failures} | ${cell(e.failingCommand, 60)} |`),
    "",
    ...(s.commonFixes.length ? [
      `## ${t("Sonrasında işe yarayan", "What worked afterwards")}`, "",
      ...s.commonFixes.map((f) => `- \`${cell(f.cmd, 100)}\` (${f.n}×)`),
      "",
      `> ${t("Bu, hatadan sonra çalışan ilk komuttur — düzeltmenin kendisi olmayabilir, ama dersi çıkarmak için başlangıç noktasıdır.", "This is the first command that succeeded after the failure — it may not be the fix itself, but it is where the lesson starts.")}`,
      "",
    ] : []),
    `\`node scar.mjs --draft ${s.id}\``,
    "",
  ].join("\n");

  emit({ kind: "show", scar: { ...slim(s), episodes: s.episodes } }, md);
}

// ---------- komut: --draft ----------

function cmdDraft(id) {
  const { scars } = mine();
  const s = scars.find((x) => x.id === id || x.id.endsWith(id));
  if (!s) return notFound(id);
  const text = draft(s, { lang: LANG });
  if (OUT) {
    const target = resolve(OUT);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text, "utf8");
    process.stdout.write(`${t("yazıldı", "written")}: ${target}\n`);
  } else {
    process.stdout.write(text + "\n");
  }
}

// ---------- komut: --verify ----------

const DOC_NAMES = /^(CLAUDE|AGENTS|GEMINI|README|LEARNINGS)\.md$/i;

/** Repoda ve global ajan dosyalarında scar işaretlerini arar. */
function collectMarkers(repo) {
  const found = new Map(); // scarId -> { file, writtenAt }
  const roots = [
    resolve(repo),
    join(homedir(), ".claude"),
    join(homedir(), ".codex"),
    join(homedir(), ".gemini"),
  ];
  const visit = (file) => {
    let text, st;
    try { text = readFileSync(file, "utf8"); st = statSync(file); } catch { return; }
    for (const id of findMarkers(text)) {
      const prev = found.get(id);
      const writtenAt = new Date(st.mtimeMs).toISOString();
      if (!prev || writtenAt < prev.writtenAt) found.set(id, { file, writtenAt });
    }
  };
  const walk = (dir, depth = 0) => {
    if (depth > 4 || !existsSync(dir)) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name === ".git" || e.name === "projects" || e.name === "sessions") continue;
      const p = join(dir, e.name);
      let isDir = e.isDirectory();
      if (!isDir && e.isSymbolicLink()) { try { isDir = statSync(p).isDirectory(); } catch { isDir = false; } }
      if (isDir) walk(p, depth + 1);
      else if (e.name.endsWith(".md") && (DOC_NAMES.test(e.name) || dir.includes("rules") || dir.includes("decisions") || dir.includes("scar"))) visit(p);
    }
  };
  for (const r of roots) walk(r);
  return found;
}

function cmdVerify() {
  const { window: w, scars } = mine();
  const markers = collectMarkers(REPO);

  const written = [];
  for (const s of scars) {
    const m = markers.get(s.id);
    if (!m) continue;
    written.push({ ...slim(s), artifactFile: m.file, ...measureEffect(s, m.writtenAt) });
  }
  const unwritten = scars.filter((s) => !markers.has(s.id));
  // Repoda işareti olan ama artık yara izi listesinde olmayanlar: hata tamamen durmuş
  const silent = [...markers.keys()].filter((id) => !scars.some((s) => s.id === id));

  const verdictLabel = {
    tuttu: t("tuttu", "held"),
    "tekrar-etti": t("tekrar etti", "recurred"),
    "kanit-yok": t("kanıt yok", "no evidence"),
    "cok-yeni": t("çok yeni — beklemeli", "too recent — wait"),
  };

  const md = [
    `# scar — ${t("ders tuttu mu?", "did the lesson hold?")}`, "",
    `**${t("Kaynak notu", "Source note")}:** ${sourceLine(w)} · ${markers.size} ${t("işaretli artefakt bulundu", "marked artifacts found")} (${resolve(REPO)})`,
    "",
    ...(written.length ? [
      `## ${t("Yazılmış dersler", "Written lessons")}`, "",
      `| ${t("Kimlik", "Id")} | ${t("yazıldı", "written")} | ${t("öncesi", "before")} | ${t("sonrası", "after")} | ${t("hüküm", "verdict")} | ${t("dosya", "file")} |`,
      "|---|---|---|---|---|---|",
      ...written.map((x) => `| \`${x.id}\` | ${day(x.writtenAt)} | ${x.before} | ${x.after} | ${verdictLabel[x.verdict]} | ${cell(basename(x.artifactFile), 30)} |`),
      "",
      ...(written.some((x) => x.verdict === "tekrar-etti") ? [
        `> ${t("Kural yazıldıktan sonra tekrar eden hata, kuralın ya yanlış ya da okunmadığı anlamına gelir. Kuralı sertleştir ya da bir hook'a bağla.", "A failure that recurs after the rule was written means the rule is wrong or unread. Tighten it, or wire it to a hook.")}`,
        "",
      ] : []),
    ] : [`## ${t("Yazılmış dersler", "Written lessons")}`, "", t("Henüz işaretli bir artefakt yok.", "No marked artifact yet."), ""]),
    ...(silent.length ? [
      `## ${t("Tamamen susmuş", "Fully silent")}`, "",
      ...silent.map((id) => `- \`${id}\` — ${t("ders yazıldıktan sonra bu hata hiç görülmedi (artık eşiği geçmiyor).", "not seen again since the lesson was written (no longer above threshold).")}`),
      "",
    ] : []),
    `## ${t("Henüz yazılmamış", "Not written yet")}`, "",
    ...(unwritten.length ? [
      `| ${t("Kimlik", "Id")} | ${t("maliyet", "cost")} | ${t("oturum", "sessions")} | ${t("hata", "error")} |`, "|---|---|---|---|",
      ...unwritten.slice(0, LIMIT).map((s) => `| \`${s.id}\` | ${s.cost} | ${s.sessions} | ${cell(s.sample, 60)} |`),
    ] : [t("Hepsi yazılmış.", "All written.")]),
    "",
  ].join("\n");

  emit({ kind: "verify", generatedAt: new Date().toISOString(), window: w, repo: resolve(REPO), written, silent, unwritten: unwritten.map(slim) }, md);
}

function notFound(id) {
  process.stderr.write(t(
    `Yara izi bulunamadı: ${id}. Önce \`--mine\` çalıştır.\n`,
    `Scar not found: ${id}. Run \`--mine\` first.\n`));
  process.exitCode = 1;
}

// ---------- giriş ----------

function main() {
  if (flag("--selftest")) {
    const a = scarsSelftest();
    const b = artifactsSelftest();
    const total = a.total + b.total;
    const fails = [...a.fails, ...b.fails];
    process.stdout.write(`${t("öz-test", "selftest")}: ${total - fails.length}/${total}\n`);
    if (fails.length) { process.stdout.write(fails.join("\n") + "\n"); process.exitCode = 1; }
    return;
  }
  if (flag("--mine")) return cmdMine();
  if (flag("--show")) return cmdShow(opt("--show"));
  if (flag("--draft")) return cmdDraft(opt("--draft"));
  if (flag("--verify")) return cmdVerify();

  process.stdout.write([
    "scar — tekrar eden ajan hatalarını kalıcı derse çevirir",
    "",
    "  --mine [--days N]            tekrar eden hata desenlerini çıkar",
    "  --show <scar-id>             tek bir yara izinin tüm epizotları ve düzeltmeleri",
    "  --draft <scar-id>            kural / test brifingi / ortam düzeltmesi taslağı (dosya yazmaz)",
    "  --verify [--repo .]          yazılmış ders hatayı durdurdu mu, ölç",
    "  --selftest                   kural öz-testi (ağ/disk yok)",
    "",
    "  --agent all|claude-code|codex|gemini-cli · --min-sessions N · --project X",
    "  --all (düşük güvenli imzaları da göster) · --md · --lang tr|en · --out DOSYA",
    "",
    `${FAMILIES.length} ${t("hata ailesi", "failure families")} · ${t("çıktı dizini önerisi", "suggested output dir")}: ${outDir()}`,
    "",
  ].join("\n"));
}

main();
