---
name: write
description: Turn a recurring agent failure into something the repo remembers — draft a rule for CLAUDE.md or AGENTS.md, a regression test brief, an environment fix or a decision record, carrying an evidence line and a marker so its effect can be measured later. Use when the user wants to write down a lesson so it stops repeating, asks to add a rule or guardrail from a failure they keep hitting, says "bunu bir daha yaşamayalım", "kural olarak yaz", "add this to CLAUDE.md", "make sure this does not happen again", or runs /scar:write <scar-id>. Not for finding which failures recur — that is scar:mine. Not for measuring whether the lesson held — that is scar:verify.
---

# Write the lesson (write)

Turn a scar into something durable. The script drafts; it never writes into the repo on its
own. What lands in the user's files is always their call.

**Language rule: write every user-facing output in the language the user is speaking with you.**
**Safety rule: propose the file and its content, show it, and wait. Never append to
CLAUDE.md, AGENTS.md or any rules file without the user agreeing to that exact text.**

## Step 0 — Know which scar

If the user named an id, use it. If they described a failure ("şu heredoc hatası"), run
`--mine --md` first and match on the error text. If they have not mined yet, mine first —
writing a rule for a failure that happened once is how rule files turn into noise.

Read `${CLAUDE_PLUGIN_ROOT}/skills/write/references/artifacts.md` before drafting: it says
where each artifact type belongs and what makes a rule one the agent will actually follow.

## Step 1 — Draft

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/scar.mjs" --draft <scar-id>
```

The draft carries three things that matter: the **evidence line** (sessions, projects,
period), the **lesson**, and a **marker** `<!-- scar:<id> -->`. Keep the marker. It is what
lets `/scar:verify` come back later and measure whether the rule actually stopped the
failure; a rule without it cannot be checked.

## Step 2 — Make the lesson yours

The generated rule is a starting sentence, not a finished one. Rewrite it so it is:

- **Imperative and specific** — "Write multi-line content with the file-writing tool, not a
  shell heredoc" beats "be careful with heredocs".
- **Testable by reading** — someone should be able to look at a command and say whether it
  breaks the rule.
- **Bounded** — say when the rule does *not* apply, or it gets ignored the first time it is
  inconvenient.
- **Short** — one or two lines. A rule that needs a paragraph is usually two rules.

Keep the evidence line. It is what stops the rule from being deleted in six months by
someone who does not know why it is there.

## Step 3 — Put it where it will be read

Ask before writing, and propose the location by scope:

| Scope | Goes in |
| --- | --- |
| this repo only | the repo's `CLAUDE.md` / `AGENTS.md`, or `.claude/rules/<name>.md` |
| every project | the user's global instructions file |
| a machine setup step | a decision or setup note — **not** a rule that is repeated forever |
| a code defect | a test in the repo's existing framework, plus a one-line note |

Before appending, **read the target file** and check whether the lesson is already there in
other words. Duplicated rules are worse than missing ones: they train the reader to skim.
If something close already exists, propose editing that line instead of adding a new one.

## Step 4 — For test briefs, write the actual test

The `test` artifact is a brief, not code — the repo's own framework decides the shape. Write
the test in the style already used in that repo, then confirm the important part: the test
must **fail** when the fix is reverted. A regression test that passes either way records
nothing. Put the marker in a comment above it.

## Step 5 — Reply

Short: which scar, what evidence it carries, where you propose putting it, and the exact
text. Then ask for the go-ahead. After writing, say one line about when it will be worth
running `/scar:verify` — the effect cannot be measured for at least a week, because the
failure needs the chance to recur before its absence means anything.
