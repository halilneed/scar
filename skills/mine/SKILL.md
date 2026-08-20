---
name: mine
description: Find the failures that keep happening — mine local session logs from Claude Code, Codex CLI and Gemini CLI for error patterns that recur across separate sessions, ranked by how much they actually cost, with the failing commands and what worked afterwards. Use when the user asks why the same thing keeps breaking, wants to know what trips their agent up repeatedly, is setting up rules or a CLAUDE.md and wants evidence for what to put in it, says "hep aynı hataya takılıyoruz", "what keeps going wrong", "tekrar eden hatalarımı çıkar", or runs /scar:mine. Not for turning a finding into a rule or test — that is scar:write. Not for checking whether a written lesson worked — that is scar:verify.
---

# Recurring failures (mine)

A failure that happened once is an event. The same failure across eight sessions was
forgotten eight times — that is a scar, and it is worth writing down. Everything is read
locally; no network call and no quota.

**Language rule: write every user-facing output in the language the user is speaking with you.**
**Evidence rule: a scar is only reported with its recurrence — how many separate sessions,
how many projects, over what period. Without that, it is one bad afternoon, not a pattern.**

## Step 1 — Mine

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/scar.mjs" --mine --md
```

Narrow with `--days 90`, `--project <name>`, or `--agent codex`. Raise `--min-sessions 3`
when the list is long — the threshold is what separates a pattern from noise. Requires
Node.js 18+; if `node` is missing, stop and say so.

Read the source note first: how many sessions were scanned, how many were unreadable, and
how many low-confidence signatures were dropped. Those numbers bound every claim you make.

## Step 2 — Read the ranking as cost, not as frequency

The `cost` column is **separate sessions × spread**, not raw occurrences, because twenty
retries inside one session is one lesson while the same error in eight sessions is eight
interruptions. Ranking by raw count would put a single bad afternoon on top.

Look at three things per row:

- **Sessions vs occurrences** — 3 sessions / 40 occurrences is a wall someone kept hitting
  in one place; 12 sessions / 14 occurrences is a habit.
- **Projects** — a scar in one project is a project problem; the same one in six projects
  is a workflow or environment problem, and belongs in a global rule.
- **Agents** — a scar in more than one agent is never about that agent's quirks.

## Step 3 — Open the ones worth acting on

For each candidate:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/scar.mjs" --show <scar-id> --md
```

This gives every episode with its date, project and **the actual failing command**, plus
what succeeded afterwards. Read the failing commands together — the pattern is usually
obvious from them, not from the error text. If ten failing commands all share a shape, that
shape is the lesson.

Watch for the tool-switch signal: when the error came from one tool and the work succeeded
with a different one right after, the lesson is not a better command, it is a better tool
choice. Say that explicitly.

## Step 4 — Decide what each one deserves

The report proposes an artifact type per family (`rule`, `test`, `environment`, `decision`).
Treat it as a starting point and check it against what you just read:

| If the failure is | It wants |
| --- | --- |
| the agent doing the wrong thing | a **rule** — one imperative line it will read next time |
| a defect in the code | a **test** — the rule would only restate the bug |
| the machine being set up wrong | an **environment** fix, done once, not a rule repeated forever |
| something the platform simply does not allow | a **decision** record, so nobody tries again |

Say plainly when a scar deserves nothing: some recurring errors are cheap and self-correcting,
and adding a rule for them costs more attention than the error does.

## Step 5 — Reply

Under 12 lines: how many sessions were scanned, how many scars cleared the threshold, the
top three with their recurrence and one line each on what the lesson is, and which single
one to write down first. Point to `/scar:write <id>` for that one. If nothing recurs, say
so — a clean mine over a long history is a real result.
