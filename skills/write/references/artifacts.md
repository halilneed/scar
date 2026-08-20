# Artifact types and where they belong

Every failure family maps to a default artifact type, but the mapping is a suggestion. What
decides it is a single question: **who has to change so this stops happening?**

| Who changes | Artifact | Lives in |
| --- | --- | --- |
| the agent's behaviour | rule | `CLAUDE.md` / `AGENTS.md`, or `.claude/rules/<name>.md` |
| the code | test | the repo's existing test suite |
| the machine | environment fix | a setup note or a decision record — done once |
| nobody, it is a hard limit | decision record | `decisions/<name>.md` or the equivalent |

## Rules

A rule is read on every run. That is its power and its cost: five good rules are followed,
fifty are skimmed. Before adding one, check that the same lesson is not already written in
other words.

A rule that gets followed is:

- **Imperative** — "Resolve the home directory in the skill and pass the full path" not
  "be careful with `~`".
- **Checkable by reading** — someone looking at a command can say whether it complies.
- **Bounded** — name where it does not apply, or the first inconvenient case kills it.
- **Short** — one or two lines. Needing a paragraph usually means it is two rules.
- **Evidenced** — keep the line saying how many sessions and projects it came from. That is
  what stops it being deleted by someone who does not know why it is there.

Scope matters as much as wording. A scar seen in one project belongs in that repo. The same
scar across six projects is a workflow problem and belongs in the global instructions —
putting it in one repo guarantees it recurs in the other five.

## Tests

Reach for a test when the failure was the code being wrong, not the agent behaving wrong. A
rule in that case only restates the bug and leaves it in place.

The generated artifact is a **brief**, not code: the repo's own framework and conventions
decide the shape. Write it in the style already there, and then verify the part that
actually matters — the test must **fail when the fix is reverted**. A regression test that
passes either way records nothing but costs runtime forever.

Put the marker in a comment above the test so `/scar:verify` can find it.

## Environment fixes

Some failures are not the agent's fault and not the code's: the machine is set up in a way
that breaks things. Execution policy blocking scripts, a missing binary, an unset git
identity.

These want a **one-time fix plus a note**, not a rule. Writing "remember to pass
`-NoProfile`" as a rule means paying attention to it forever; fixing the profile pays once.
When the fix changes machine-wide behaviour — security policy, PATH, global git config —
say what it changes and how to undo it, and let the user decide. Prefer the narrowest
change that works.

## Decision records

When the wall is a platform limit — a feature not enabled on the account, an API that does
not exist — the lesson is "stop trying". A decision record says what was attempted, what
the answer was, and when it should be revisited.

This is the cheapest artifact and the most under-used. A single line saved from re-litigating
the same dead end pays for itself the first time.

## The marker

Every artifact carries `<!-- scar:<id> -->`. It is the only mechanism that closes the loop:
`/scar:verify` finds the marker, takes the file's date, and counts occurrences before and
after. Without it, whether a rule works is a matter of opinion.

Keep one marker per lesson. If one file holds several lessons, each gets its own marker line
next to its own section — a marker at the top of a file with ten rules cannot tell which one
worked.

## What deserves nothing

Some recurring errors are cheap: they fail fast, the recovery is obvious, and the agent
handles them without help. Writing a rule for those spends attention on every future run to
save a few seconds occasionally. Saying "this one is not worth a rule" is a legitimate
outcome and keeps the rule file worth reading.
