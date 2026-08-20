# Failure families and how to read them

Each family is a transparent pattern in `scripts/lib/scars.mjs`, matched against the single
error line extracted from the failure output. The family decides the **default artifact
type** — but read the failing commands before accepting it.

Turn the recurrence threshold with `--min-sessions N`. Show signatures the extractor was
unsure about with `--all`.

## How a scar is built

1. **Episode** — one or more consecutive failed tool results, plus the first success that
   followed. A retry loop is one episode, not twenty.
2. **Error line** — agent wrapper lines (`Exit code:`, `Wall time:`, `Output:`) are stripped;
   Python tracebacks resolve to their last line; PowerShell position lines are skipped. If
   no line looks like an error, the episode is marked low-confidence and dropped by default.
3. **Signature** — paths, numbers and hashes are replaced with placeholders so the same
   failure in two projects collapses to one scar.
4. **Recurrence** — only signatures seen in `--min-sessions` or more **separate sessions**
   become scars.
5. **Cost** — sessions × 3 + projects × 2 + occurrences (capped) + a bonus when it spans
   more than one agent. Not raw frequency: twenty retries in one afternoon is one lesson.

## The families

| id | default | reading it |
| --- | --- | --- |
| `powershell-execution-policy` | environment | The profile or script cannot load. Recurs in every new shell, so a rule would be paid forever — fix the invocation or the policy once. |
| `not-a-git-repo` | rule | Almost always a working-directory problem, not a git problem. Check whether compound commands assume a `cd` that did not carry over. |
| `git-identity` | environment | Unset user name/email. On a machine with several accounts, setting it globally is the wrong fix — bind it per command. |
| `shell-quoting` | rule | Heredocs and nested quotes breaking at the tool layer. The line number in the error is misleading; the cause is the content. Look for a tool-switch signal. |
| `edit-precondition` | rule | A tool contract was violated: edit without reading first, or a non-exact match. The fix is procedural, and cheap to state. |
| `command-not-found` | environment | Missing binary or PATH. Recurs on every new machine; documenting the install is what ends it. |
| `module-not-found` | rule | Missing dependency **or** the command run from the wrong directory — the two look identical. Check the directory first. |
| `file-not-found` | rule | Path wrong or the file is not where it was assumed. The error's own working-directory line usually gives it away. |
| `permission-or-lock` | rule | On Windows, most often a running process holding a build output. Escalating privileges hides it instead of fixing it. |
| `port-in-use` | rule | Usually a leftover process from an earlier session. |
| `auth` | environment | Wrong account active is the most common cause when several are configured. |
| `rate-limit` | rule | Retrying immediately makes it worse; the lesson is backoff. |
| `timeout` | rule | The command often keeps running after the timeout — starting it twice is the real damage. |
| `test-failure` | test | A behaviour defect. A rule here only restates the bug. |
| `compile-error` | test | The build gate catches it earlier and cheaper than a rule does. |
| `feature-unavailable` | decision | A platform limit. The lesson is "stop trying", and it belongs in a decision record. |
| `other` | rule | Unclassified. Read the failing commands — the pattern is usually in them, not in the error text. |

## The tool-switch signal

When more than half the episodes end with a *different tool* succeeding right after the
failure, the report says so. This is the strongest signal in the tool, because the lesson is
not a corrected command — it is a corrected choice: *do not do this with that tool*.

It also explains why the "what worked afterwards" command can be missing: when the fix was
switching tools, there is no successful shell command to point at.

## What the mine cannot see

- **Silent wrong answers.** Only failures with a non-zero result are visible. Code that ran
  fine and did the wrong thing leaves no trace here.
- **Failures the user fixed by hand** outside the agent.
- **Why** anything failed. The tool gives recurrence, the failing commands, and what ran
  next. Reading the cause out of those is the part that needs judgement — do not skip it by
  quoting the error text back as if it were an explanation.
