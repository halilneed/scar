---
name: verify
description: Check whether a written lesson actually worked — find the rules, tests and notes that carry a scar marker, then compare how often the failure occurred before and after each one was written, so rules that are being ignored are visible instead of assumed. Use when the user asks whether a rule is working, wants to prune rules nobody follows, is reviewing a CLAUDE.md or rules directory, says "bu kural işe yaradı mı", "did that rule help", "kurallarımı gözden geçir", or runs /scar:verify. Not for finding recurring failures — that is scar:mine. Not for drafting a rule — that is scar:write.
---

# Did the lesson hold? (verify)

Writing the rule is the easy half. This measures the other half: after the lesson was
written, did the failure actually stop? Local only, no quota.

**Language rule: write every user-facing output in the language the user is speaking with you.**
**Honesty rule: a rule written last week that has not recurred proves nothing yet. Report
"too recent" as its own verdict; do not let it read as success.**

## Step 1 — Measure

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/scar.mjs" --verify --repo "<repo>" --md
```

The script looks for `<!-- scar:<id> -->` markers in the repo's docs, rules and decision
files — and in the global agent config directories — takes each file's modification time as
the date the lesson was written, and counts occurrences of that failure before and after.

Requires Node.js 18+. If nothing is marked, say so plainly and point at `/scar:write`: the
loop cannot be closed for rules that carry no marker, and that is a gap worth naming rather
than an error.

## Step 2 — Read the four verdicts

| Verdict | Means | What to do |
| --- | --- | --- |
| **tuttu / held** | occurred before, not since, and enough time has passed | Leave it alone. This is the rule earning its place |
| **tekrar etti / recurred** | still happening after the rule was written | The interesting one — see below |
| **çok yeni / too recent** | written less than a week ago | Nothing yet. Check back later |
| **kanıt yok / no evidence** | no occurrences before it either | The rule may be pre-emptive, or the marker may be on the wrong lesson |

File modification time is a proxy for when the lesson was written. If a file was reformatted
or moved after the rule was added, the date is later than the truth and the "before" count
is inflated. When a result looks strange, check the file's git history before trusting it.

## Step 3 — A recurring failure is a finding about the rule

When a lesson recurred after being written, the rule is not innocent. Work out which:

1. **Not read** — it is in a file the agent does not load, or buried in a long document.
   Move it up, or into the file that is actually loaded every session.
2. **Not actionable** — it says "be careful" instead of naming the action. Rewrite it as an
   instruction someone can follow without interpretation.
3. **Wrong** — the lesson drawn from the original failure was not the real cause. Re-open it
   with `/scar:mine` and read the failing commands again.
4. **Unenforceable by text** — some failures are not solved by asking nicely. If the rule
   keeps losing, propose a hook, a lint check or a permission entry instead. Say plainly
   that a rule is the wrong instrument here.

Name which of the four applies and why, using the occurrence dates as evidence.

## Step 4 — Prune

Rules accumulate and every one costs attention on every run. Two candidates for removal:

- **kanıt yok** entries where the failure never actually happened — written speculatively.
- **tuttu** entries whose cause disappeared (a tool was replaced, a dependency removed).

Never remove a rule on the numbers alone; ask, and say what would happen if it went.

## Step 5 — Reply

Short: how many marked lessons, how many held, how many recurred, and for each recurrence
which of the four causes applies plus the one change you recommend. Then the unwritten
scars still on the list, highest cost first. If every lesson held, say it in one line — that
is the outcome the whole loop exists for.
