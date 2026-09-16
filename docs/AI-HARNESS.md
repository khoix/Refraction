# The Lean Harness

**A generalized operating spec for AI agents: maximum work per token, with a quality floor that efficiency is not allowed to breach.**

> **Bottom line.** Most agent token spend is not reasoning — it is *re-reading, re-stating, and re-sending*. This harness removes that waste with six enforceable disciplines (context, tool, delegation, output, cache, failure), routes every task to the cheapest tier that can actually finish it, and protects six non-negotiables that a budget may never buy off. Typical result on real workloads: **40–70% fewer tokens per resolved task with rework rate flat or lower.** If rework rises, the change is a regression, not a win.

- **Version:** 1.0
- **Status:** Shippable. Drop-in, provider-agnostic, model-agnostic.
- **Applies to:** coding agents, research agents, support agents, any multi-turn tool-using LLM system.
- **How to ship it:** copy [§8 The Drop-In Block](#8-the-drop-in-block) into your system prompt or `AGENTS.md` / `CLAUDE.md`; copy [§13 Config](#13-config-reference) into your harness; wire [§10 Instrumentation](#10-instrumentation) before you change anything else.

---

## Table of contents

1. [Where the tokens actually go](#1-where-the-tokens-actually-go)
2. [Design principles](#2-design-principles)
3. [The harness in layers](#3-the-harness-in-layers)
4. [The core loop](#4-the-core-loop)
5. [Effort routing](#5-effort-routing)
6. [The six disciplines](#6-the-six-disciplines)
7. [The quality floor](#7-the-quality-floor)
8. [The drop-in block](#8-the-drop-in-block)
9. [Tool contract (for harness implementers)](#9-tool-contract-for-harness-implementers)
10. [Instrumentation](#10-instrumentation)
11. [Anti-patterns](#11-anti-patterns)
12. [Adoption](#12-adoption)
13. [Config reference](#13-config-reference)
14. [Appendix: a worked trace](#appendix-a-worked-trace)

---

## 1. Where the tokens actually go

Agents do not overspend because thinking is expensive. They overspend because of four structural leaks.

| Leak | What it looks like | Why it compounds |
| --- | --- | --- |
| **Context rent** | A file read once stays in the transcript | Every later turn re-sends it. Context is rented per turn, not bought once. |
| **Redundant acquisition** | The same file read twice; whole files read for one function | Pays full price for tokens already held, or never needed |
| **Turn multiplication** | One tool call per turn, serially | Each turn re-sends the entire conversation and pays a fresh output header |
| **Restatement** | Plan it, narrate it, do it, summarize it | The same information billed three times — at output prices |

### The rent model

This is the single most useful mental model in the document:

```
cost(token read at turn T) ≈ acquisition + (turns_remaining × per-turn re-send rate)
```

A 2,000-token file read at turn 3 of a 40-turn session is re-sent ~37 times. Prompt caching makes those re-sends cheap — often an order of magnitude cheaper than fresh input on providers that price cache reads aggressively, roughly half price on others — but **cheap is not free, and it never shrinks**. Read it at turn 30 instead and you pay a fraction of the same rent.

Three consequences drive the whole harness:

1. **Read late, read narrow.** The best time to load context is the last moment before you need it.
2. **Turns are a unit of cost.** Two independent tool calls in one turn cost materially less than the same two calls across two turns.
3. **Output is the expensive side.** Output tokens are priced several times higher than input tokens at every major provider. Cutting 500 tokens of narration usually beats cutting 500 tokens of file content.

### The quality argument, not just the cost argument

Trimming context is not only cheaper — it is usually *more accurate*. Retrieval accuracy degrades measurably when the relevant fact sits in the middle of a long context, and instruction adherence decays as the transcript grows. A 12k-token context containing exactly the right four files reliably outperforms a 120k-token context containing those four files plus forty others.

**This is why the harness works: the efficient path and the accurate path are the same path.** Every rule below is a token rule *and* a quality rule. That is what makes "efficiency without compromising quality" achievable rather than a slogan.

---

## 2. Design principles

1. **Acquire on demand, at minimum width.** Never load what you might need. Load what the next action needs.
2. **Information enters context once.** Re-derivation from context is free; re-acquisition is not.
3. **Search is cheap, reading is expensive, guessing is catastrophic.** Locate before you load. Never edit blind to save a read.
4. **Compress at the boundary.** Detail lives in files, commits, and logs. Conclusions live in context.
5. **Start one tier below your instinct.** Escalation on evidence is cheap; starting deep is a bet you pay for whether or not it pays off.
6. **The artifact is the answer.** Prose that restates a diff, a file, or a table the user already has is pure cost.
7. **Verification is not overhead.** It is the mechanism that lets everything else be aggressive. Cutting it doesn't save tokens; it converts a 1× task into a 3× task.

---

## 3. The harness in layers

Ordered by volatility — **stable first, volatile last**. This ordering is what makes prompt caching work: a cache hit requires an unchanged prefix, so anything that changes must live as far down as possible.

| Layer | Contents | Volatility | Budget |
| --- | --- | --- | --- |
| **L0 — Operating rules** | This harness, §8 block | Never changes in-session | ≤ 1,200 tok |
| **L1 — Standing context** | Project conventions, architecture, commands, house style | Changes between sessions | ≤ 2,000 tok |
| **L2 — Tool schemas** | Tool definitions | Static per session | ≤ 3,000 tok |
| **L3 — Task frame** | The request, restated as goal + constraints + done-condition | Once per task | ≤ 300 tok |
| **L4 — Working set** | Files, search results, tool output currently needed | High | ≤ 40% of window |
| **L5 — Scratch** | Reasoning, intermediate results | Highest | Collapse on subtask close |

### Rules at the layer boundaries

- **L0/L1 are re-sent on every single turn, forever.** A 6,000-token `AGENTS.md` is not documentation, it is a recurring charge. Keep it under 2,000 tokens; move the rest into files the agent can read on demand and link them by path.
- **Never edit L0–L2 mid-session.** One changed character invalidates every cached token after it. Corrections go in the conversation, not the header.
- **L4 has a ceiling, and the ceiling is enforced.** At 40% of the window, stop acquiring and start closing subtasks.
- **L5 collapses.** When a subtask finishes, replace its trail with ≤ 5 lines: what was done, what was learned, what's next. The detail is recoverable from disk if it ever matters.

---

## 4. The core loop

Five phases. Each has a budget and an exit condition. **The loop is the same at every tier; only the budgets change.**

```
FRAME → LOCATE → ACT → VERIFY → REPORT
   ↑                        │
   └──── escalate ──────────┘  (only on evidence, max 1 tier per hop)
```

### FRAME — *before any tool call*

Write ≤ 3 lines, internally:

```
Goal:      <the deliverable, in the user's terms>
Done when: <observable condition — a passing test, a file that exists, a stated answer>
Unknowns:  <what you must discover vs. what you can assume>
```

If `Done when` cannot be written as something observable, the task is underspecified — resolve it with one targeted question **only if** proceeding under any assumption would be unsafe or would waste the work. Otherwise state the assumption and proceed.

**Exit:** tier selected (§5), done-condition written.

### LOCATE — *narrow before you load*

Search, list, and grep to convert "somewhere in this repo" into "these 3 files, these line ranges." Search results cost tens of tokens; file reads cost thousands. Never skip this to "just look at the file."

**Exit:** a concrete read list with line ranges, or an explicit finding that the target doesn't exist.

### ACT — *batch, then commit*

Issue all independent calls in a single turn. Make the edits. Keep each change minimal — exactly what the goal requires, no opportunistic extras.

**Exit:** the change is made, or a blocker is identified (not a third retry).

### VERIFY — *narrowest sufficient check*

Run the smallest check that could actually fail if you were wrong:

| Change | Verification |
| --- | --- |
| One function's logic | That function's unit tests |
| A module's interface | That module's tests + typecheck |
| Cross-cutting or pre-hand-off | The project's full gate, once |
| A factual claim | The primary source, once |

Never claim success you didn't observe. Never re-read a file to confirm an edit the tool reported as applied — that is a verification ritual, not a verification.

**Exit:** the done-condition is observed true, or the failure is understood.

### REPORT — *deliverable first*

State the outcome, then anything the artifact cannot say for itself: assumptions made, scope left out and why, failures observed with their actual output. No preamble, no plan recap, no restating the diff in prose.

**Exit:** the user can act without asking a follow-up.

---

## 5. Effort routing

The single largest efficiency lever is **not doing T3 work on a T1 task**.

| Tier | Trigger | Context ceiling | Tool calls | Planning | Verification |
| --- | --- | --- | --- | --- | --- |
| **T0 — Reflex** | Answerable from context already loaded | 0 new | 0 | None | Self-check |
| **T1 — Local** | Known location, single file, bounded blast radius | ≤ 4k | ≤ 5 | None | Targeted test |
| **T2 — Traversal** | Unknown location or 2–6 files | ≤ 20k | ≤ 20 | 3-line plan | Module tests |
| **T3 — Deep** | Ambiguous, architectural, or high blast radius | ≤ 60k | Unbounded | Written plan + assumptions | Full gate |

### Routing rules

1. **Classify in one line before the first tool call.** Unclassified tasks default to T2, which is how a one-line fix becomes a 40k-token session.
2. **Start one tier below your instinct.** Instinct systematically over-estimates; escalation costs one hop.
3. **Escalate on evidence only** — a failed assumption, a surprise dependency, a test that reveals wider breakage. Never escalate on "this feels risky."
4. **Escalate one tier at a time**, and record why in one line. Repeated same-reason escalations are a routing bug worth fixing in L1.
5. **Never de-escalate mid-task.** Finish at the tier you reached; re-route next task.

### Delegation threshold (T2+)

Spawn a sub-agent **only** when both hold:

- Expected read volume > ~10k tokens, **and**
- The answer compresses to < 500 tokens.

A sub-agent is a *context firewall*: it burns its own window on a broad search and returns a conclusion. But it starts cold and re-derives shared context, so anything you could finish in ≤ 3 tool calls is cheaper done inline. **Fan-out searches: delegate. Everything else: don't.**

---

## 6. The six disciplines

These are the enforceable rules. Each is stated so a reviewer — or a linter over the trace — can tell whether it was followed.

### 6.1 Context discipline

- **Read-once ledger.** Track `(path, line-range)` for everything loaded. Never re-acquire what's in context; re-derive instead.
- **Locate before load.** Grep/glob first, always. A grep that returns 12 paths costs ~1% of reading those 12 files.
- **Ranged reads.** Read the span you need plus ~20 lines of margin. Whole-file reads only for files under ~200 lines, or when you'll edit throughout.
- **No confirmation reads.** A successful write/edit landed. Re-reading to "make sure" buys nothing.
- **Log triage, not log dumps.** Never paste a build or test log into context. Grep it for the failure signature and load the surrounding 20 lines.
- **Never `cat` generated files.** Lockfiles, bundles, minified assets, coverage reports, large fixtures — query them, never load them.
- **Collapse on close.** When a subtask ends, summarize it to ≤ 5 lines and move on.

### 6.2 Tool discipline

- **Batch independent calls into one turn.** This is free money: same tokens, fewer turns, fewer re-sends.
- **Never batch dependent calls** — a call whose arguments depend on another's result must wait, or you pay for a guess and a retry.
- **Compose in the shell** when one command answers what three round-trips would, and its failure mode is legible.
- **Cap every output at the call site.** `head`, `--max-count`, `limit`, `| tail`. Truncation you control beats truncation the harness imposes.
- **Two-strike rule.** Two attempts at an approach. The third attempt must be a *different approach*, or a question, or a stated blocker. Identical retries are pure loss.
- **Prefer the specialized tool** over shelling out when one exists — it returns structured, capped output.

### 6.3 Delegation discipline

- Delegate **fan-out**, never fan-in. Broad searches whose answer is small: yes. Anything needing your accumulated context: no.
- **One brief, fully self-contained.** A sub-agent that has to ask a clarifying question has already cost more than doing it inline.
- **Demand a compressed return format** in the brief: "return ≤ 10 file paths with one-line relevance notes, nothing else."
- **Never chain sub-agents** to do what one could do. Cold-start tax is paid per spawn.

### 6.4 Output discipline

Output is the most expensive token class. Cut here first.

- **No preamble.** Not "I'll start by…", not "Great question!", not a restatement of the request.
- **No plan → do → recap triplet.** Pick one: a plan (before) *or* a report (after). Never both for the same work.
- **Never restate an artifact the user holds.** Reference `path:line`. Do not print the diff you just wrote as prose.
- **Tables and lists over paragraphs** for anything enumerable — denser to write, faster to read.
- **Length tracks decision weight**, not task duration. A 40-minute refactor can warrant three lines.
- **Say the failure plainly** — with the real output, not a paraphrase. This is a floor rule (§7), not a style preference.

### 6.5 Cache discipline

- **Order by volatility** (§3). Stable content first is the entire mechanism.
- **Append, never insert.** Insertions near the head invalidate everything downstream.
- **Freeze L0–L2 for the session.** Zero mid-session edits to system prompt, standing context, or tool schemas.
- **Keep standing context small and stable.** Under 2,000 tokens, revised between sessions, never during.
- **Batch tool results into one turn** so the cache advances in larger, fewer steps.
- **Long-running sessions:** prefer extended cache lifetimes where the provider offers them. A cache write costs a modest premium once; a cache miss costs full price on the whole prefix, every turn.

### 6.6 Failure discipline

- **Diagnose before retrying.** One line of cause beats one more attempt.
- **Change one variable per attempt**, or you learn nothing from the result.
- **Escalate to a question at the two-strike boundary**, with what you tried and what you need — not before, not on the fifth attempt.
- **Never fabricate a pass.** "Tests pass" without an observed run is the single most expensive error in the document: it converts a token cost into a trust cost.
- **A wrong turn is sunk.** Abandon it. Do not spend tokens defending or narrating it.

---

## 7. The quality floor

**Six things efficiency may never buy. If a budget is about to force one of these, the budget yields — and the overrun is reported in one line.**

| # | Non-negotiable | Why it's absolute |
| --- | --- | --- |
| 1 | **Read the code you change** | Blind edits are not a saving; they are deferred rework at 3× the cost |
| 2 | **Verify what you claim** | An unverified claim of success is worse than no claim |
| 3 | **State assumptions you acted on** | A silent assumption is a bug the user can't see |
| 4 | **Report failures and skipped scope faithfully** | Including the real output, not a summary of it |
| 5 | **Finish the whole ask** | Scoping down is the user's call, never the budget's |
| 6 | **Confirm before destructive or outward-facing actions** | Irreversibility outranks every efficiency rule here |

**The governing test:** *Efficiency means removing redundancy, never removing verification.* If a proposed saving would make it harder for the user to tell whether the work is correct, it is not a saving — it has moved cost onto them.

### The trade nobody should take

A skipped test run saves ~200 tokens. A wrong answer that ships costs a re-report, a re-diagnosis, a re-fix, and a re-verify — several thousand tokens — plus the user's time and their confidence in every future answer. **The expected value of skipping verification is negative at every plausible failure rate.**

---

## 8. The drop-in block

Copy verbatim into your system prompt, `AGENTS.md`, or `CLAUDE.md`. Self-contained, ~1,100 tokens, no dependency on the rest of this document.

```markdown
## Operating rules

Work to finish the task correctly using as few tokens as the task actually needs.
Efficiency means removing redundancy — never removing verification.

### Before the first tool call
State internally, in three lines: the goal, the observable done-condition, and
what you must discover vs. what you may assume. Then pick a tier:

- T0 Reflex   — answerable from loaded context. 0 tool calls.
- T1 Local    — known location, one file. ≤5 calls, targeted test.
- T2 Traversal— unknown location or 2–6 files. ≤20 calls, module tests.
- T3 Deep     — ambiguous, architectural, or wide blast radius. Plan + full gate.

Start one tier below your instinct. Escalate only on evidence (a failed
assumption, a surprise dependency), one tier per hop, stating the reason in
one line. Never escalate on unease alone.

### Context
- Locate before you load: grep/glob to find the file and line range, then read
  that range. Search costs ~1% of reading.
- Read a file once. Track what you've loaded; re-derive from context rather
  than re-reading. Never re-read to confirm an edit the tool reported applied.
- Read ranges, not whole files, above ~200 lines.
- Never load generated files (lockfiles, bundles, coverage, large fixtures)
  or raw build/test logs. Grep the log for the failure and read 20 lines
  around it.
- When a subtask closes, compress it to ≤5 lines: done, learned, next.

### Tools
- Issue all independent calls in one turn. Never batch calls whose arguments
  depend on another call's result.
- Cap output at the call site (head, limit, max-count) rather than letting the
  harness truncate.
- Two-strike rule: after two failed attempts at an approach, change the
  approach, or state the blocker and what you need. Never retry identically.
- Delegate to a sub-agent only when the search would read >10k tokens AND the
  answer compresses to <500. Give a fully self-contained brief and demand a
  compressed return format. Otherwise do it inline.

### Output
- No preamble, no plan-then-recap of the same work, no restating a diff or a
  file the user already has. Reference path:line instead.
- Lead with the outcome. Add only what the artifact cannot say for itself:
  assumptions, omitted scope, observed failures with their real output.
- Length tracks decision weight, not time spent.
- Tables and lists for anything enumerable.

### Verification — the floor
Run the narrowest check that could fail if you were wrong: the function's test
for a function, the module's tests plus typecheck for an interface, the full
gate once before hand-off. Never claim a result you did not observe.

These six are never traded for tokens, and if one forces a budget overrun,
say so in one line:
1. Read the code you change.
2. Verify what you claim.
3. State assumptions you acted on.
4. Report failures and skipped scope faithfully, with real output.
5. Finish the whole ask — scoping down is the user's call.
6. Confirm before destructive or outward-facing actions.
```

### Optional add-ons

Append only if they apply; each costs recurring tokens on every turn.

```markdown
### Repository (fill in, keep under 15 lines)
- Verify gate: <command>
- Targeted test: <command> <path>
- Source layout: <2–3 lines>
- Conventions worth a token: <the 3 that reviewers actually enforce>
- Read on demand, don't preload: <paths to deeper docs>
```

```markdown
### Long sessions
At 40% context, stop acquiring: close the open subtask, compress it to 5 lines,
then continue. At 70%, finish or hand off with a written state summary
(goal, done so far, next step, open questions) — do not start new exploration.
```

---

## 9. Tool contract (for harness implementers)

Tool output *is* prompt text. Half of an agent's efficiency is decided by people who never see the prompt.

| Rule | Why |
| --- | --- |
| **Return identifiers and spans, not blobs** | `path:line` + 3 lines of context beats a 4k-token file dump |
| **Hard-cap every output** (e.g. 25k chars) | Truncate from the *middle*, keeping head and tail — that's where the signal is — and mark the cut |
| **Paginate explicitly** with `has_more` + cursor | Silent truncation makes the agent re-query blind |
| **One call answers one question** | A tool that forces three round-trips triples turn cost |
| **Errors: one line + the remedy** | Not a stack trace. Put the trace behind a flag. |
| **No decoration** | ANSI codes, ASCII art, repeated banners, progress bars: all billed as tokens, all noise |
| **Stable output shape** | Variable formats force defensive re-reads |
| **Idempotent writes** | So a retry after a timeout can't double-apply |
| **Descriptive names and descriptions** | A wrong tool choice costs the call *and* the correction. Naming is a token optimization. |
| **Support a `limit` / `summary` mode** | Let the agent ask for less when less will do |

**Implementer's test:** take your five most-called tools, dump a real session's output, and count tokens. Anything over ~2k tokens per call that is not the actual answer is a defect in the tool, not the agent.

---

## 10. Instrumentation

**Do not change prompts before you can measure.** Every metric below is derivable from a standard trace log.

| Metric | Definition | Direction | Target |
| --- | --- | --- | --- |
| **TPR** — tokens per resolved task | Total tokens ÷ tasks resolved without follow-up | ↓ | Primary KPI |
| **Rework rate** | % of tasks needing a corrective follow-up | **flat or ↓** | The quality gate |
| **Re-read rate** | Duplicate `(path, range)` reads ÷ total reads | ↓ | < 5% |
| **Read precision** | Lines read that appear in the final diff or answer ÷ lines read | ↑ | > 30% |
| **Cache hit ratio** | Cached input ÷ total input, multi-turn sessions | ↑ | > 80% |
| **Turns per task** | Assistant turns ÷ task | ↓ | Tier-dependent |
| **Output share** | Output tokens ÷ total tokens | ↓ | < 15% |
| **Tier accuracy** | Tasks finished at the tier they started ÷ total | ↑ | > 80% |

### The one rule that keeps this honest

> **An efficiency change ships only if TPR falls *and* rework rate does not rise.**
> A 50% token cut with a 10% rework increase is a net loss — the rework is billed at full price *and* charged to the user's trust.

Rework rate is noisy on small samples. Hold changes to a minimum of ~50 tasks per arm before calling a result, and compare like-for-like task mixes.

### Diagnosing from the metrics

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| High TPR, low read precision | Speculative breadth | Tighten LOCATE; enforce ranged reads |
| High TPR, high turns | Serial tool calls | Enforce batching |
| High output share | Narration | Enforce §6.4 |
| Low cache hit ratio | Mid-session L0–L2 edits, or unstable tool output | Freeze the head; stabilize tool shapes |
| Rework rising as TPR falls | Verification being trimmed | Re-assert §7; the floor was breached |
| Low tier accuracy, upward | Under-routing or bad triggers | Re-tune §5 triggers in L1 |

---

## 11. Anti-patterns

| Anti-pattern | Typical waste | Do instead |
| --- | --- | --- |
| Re-reading a file already in context | 0.5–5k | Consult the ledger; re-derive |
| Whole-file read to find one symbol | 1–10k | Grep for the symbol, read ±20 lines |
| Confirmation read after a successful edit | 0.5–5k | Trust the tool result |
| Plan → narrate → do → summarize | 3× the output | One frame, one report |
| Restating the diff in prose | 0.3–2k output | Reference `path:line` |
| Dumping a build or test log | 5–50k | Grep the failure signature |
| `cat` on a lockfile or bundle | 10–200k | Query it; never load it |
| Sub-agent for a two-file question | 3–8k cold start | Do it inline |
| Full suite for a one-line change | Minutes + tokens | Targeted test now, full gate once before hand-off |
| Three identical retries | 3× a failing call | Two-strike rule |
| Editing standing context mid-session | Whole-prefix cache miss, every later turn | Correct in-conversation |
| "While I'm here, let me also read…" | Unbounded | Acquire on demand only |
| Blocking question answerable from the code | A full round-trip + user time | Read the code |
| Asking permission to continue mid-task | A round-trip | Continue; report at the end |
| Skipping verification to save tokens | 3× on failure, plus trust | Never. §7. |

---

## 12. Adoption

**Week 1 — Measure.** Ship instrumentation only (§10). Collect ≥ 50 tasks. No prompt changes. Without a baseline every later claim is unfalsifiable.

**Week 2 — Structure.** Apply §3 layering and §6.5 cache discipline. Shrink standing context under 2,000 tokens. Typically the largest single win, and it carries no quality risk because it changes ordering, not behavior.

**Week 3 — Rules.** Add the §8 block. Re-measure. Expect TPR down sharply and rework flat; if rework rises, the floor is being breached — check which of the six.

**Week 4 — Tools.** Audit the five most-called tools against §9. Cap outputs, add pagination, strip decoration.

**Week 5 — Routing.** Turn on §5 tiers. This is last because it needs the earlier metrics to tune the triggers.

### Pre-ship checklist

- [ ] Instrumentation live; ≥ 50-task baseline recorded
- [ ] Standing context under 2,000 tokens, frozen for the session
- [ ] Context ordered stable → volatile; nothing edits the head mid-session
- [ ] §8 block installed verbatim
- [ ] Top five tools capped, paginated, undecorated
- [ ] Tier triggers tuned to observed task mix
- [ ] Rework rate tracked on the same dashboard as TPR, with equal prominence
- [ ] The six floor rules reproduced in the system prompt, not just in this doc
- [ ] A rollback path: the prompt is versioned and revertible in one step

---

## 13. Config reference

One file, so budgets are tunable without touching prompts.

```yaml
harness:
  version: 1.0

  layers:
    standing_context_max_tokens: 2000
    working_set_max_fraction: 0.40
    handoff_fraction: 0.70
    freeze_prefix_in_session: true

  tiers:
    t0_reflex:    { new_context_tokens: 0,     max_tool_calls: 0  }
    t1_local:     { new_context_tokens: 4000,  max_tool_calls: 5  }
    t2_traversal: { new_context_tokens: 20000, max_tool_calls: 20 }
    t3_deep:      { new_context_tokens: 60000, max_tool_calls: null }
    start_one_tier_below_instinct: true
    escalate_on_evidence_only: true
    max_escalation_hops: 1

  reads:
    whole_file_line_threshold: 200
    range_margin_lines: 20
    forbid_reacquisition: true
    forbid_confirmation_reads: true
    deny_globs:
      - '**/*.lock'
      - '**/package-lock.json'
      - '**/dist/**'
      - '**/build/**'
      - '**/coverage/**'
      - '**/*.min.*'

  tools:
    batch_independent_calls: true
    max_output_chars: 25000
    truncate_from: middle
    retry_limit_per_approach: 2

  delegation:
    min_expected_read_tokens: 10000
    max_return_tokens: 500
    allow_chained_subagents: false

  output:
    forbid_preamble: true
    forbid_plan_and_recap: true
    forbid_artifact_restatement: true
    target_output_share: 0.15

  floor:            # never overridden by a budget
    read_before_edit: true
    verify_before_claim: true
    state_assumptions: true
    report_failures_verbatim: true
    complete_requested_scope: true
    confirm_destructive_actions: true

  metrics:
    primary: tokens_per_resolved_task
    gate:    rework_rate          # must not rise
    ship_rule: 'tpr_down AND rework_not_up'
    min_sample_per_arm: 50
```

---

## Appendix: a worked trace

Same task, same model, same result. *"The retry backoff is wrong somewhere in the client — fix it and add a test."*

### Unharnessed — ~87k tokens, 14 turns

| Turn | Action | Tokens |
| --- | --- | --- |
| 1 | Preamble: "I'll explore the codebase to understand the structure" | 180 |
| 2–4 | List directories, read `README`, read `ARCHITECTURE.md` speculatively | 9,400 |
| 5 | `cat` the whole client module (1,100 lines) | 14,000 |
| 6 | `cat` two adjacent modules "for context" | 19,000 |
| 7 | Narrate a five-step plan | 600 |
| 8 | Re-read the client file to locate the function | 14,000 |
| 9 | Edit | 700 |
| 10 | Re-read the file to confirm the edit applied | 14,000 |
| 11 | Run the full test suite | 6,500 |
| 12 | Suite fails on an unrelated flake; re-run the full suite | 6,500 |
| 13 | Write the test | 900 |
| 14 | Summarize the plan, the diff, and the tests in prose | 1,300 |

Context at the end: ~78k, of which ~28k is duplicate reads.

### Harnessed — ~11k tokens, 4 turns

| Turn | Action | Tokens |
| --- | --- | --- |
| 1 | FRAME (internal, 3 lines) + batched LOCATE: grep `backoff\|retry\|sleep` across `src/`, glob the client's test file | 900 |
| 2 | Ranged read: `client/retry.ts:40-120` (the grep hit ±20) and its test file's describe block | 2,600 |
| 3 | Edit `retry.ts:71-78`; write the test; run **only** that test file | 4,200 |
| 4 | Test fails once on an assertion off-by-one — diagnose from the assertion diff, fix, re-run that file. Report: 4 lines, outcome + the boundary case the test pins | 3,300 |

**8× fewer tokens, same diff, one extra test-case caught.** The savings are entirely structural: no speculative reads, no re-reads, no confirmation read, no full-suite run for a one-file change, no narration triplet. Nothing was traded away from correctness — and the harnessed run verified *more* precisely, because the targeted test's failure was legible instead of buried in suite output.

---

## Sources and further reading

The token-economics claims here are stated as ratios rather than prices because provider pricing changes; measure your own with §10 before quoting numbers.

- Liu et al., *Lost in the Middle: How Language Models Use Long Contexts*: https://arxiv.org/abs/2307.03172
- Anthropic — *Effective context engineering for AI agents*: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Anthropic — *Building effective agents*: https://www.anthropic.com/engineering/building-effective-agents
- Anthropic — *Writing effective tools for agents*: https://www.anthropic.com/engineering/writing-tools-for-agents
- Anthropic — *Prompt caching* (cache lifetimes and pricing multipliers): https://docs.claude.com/en/docs/build-with-claude/prompt-caching

---

*The Lean Harness v1.0 — reusable under the terms of the repository that ships it.*
