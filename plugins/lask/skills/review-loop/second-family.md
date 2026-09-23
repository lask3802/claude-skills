# Second-family reviewers — tested recipes

Any agent that can read the repo headlessly in a read-only mode and print its review
to stdout can be a reviewer. Give it the shared brief file; capture stdout; never let
it write files. Measured on 2026-09-23 (Windows, Git Bash) on a 20-row inventory review.

| Reviewer | Command | Wall clock | Notes |
|---|---|---|---|
| Claude | `Agent` with `subagent_type: lask:reviewer`, prompt = "follow <brief file> exactly" | ~4 min | Highest recall in the run (15/25). |
| Codex | `lask:second-opinion` | — | Check quota first: an exhausted plan fails the first turn (`You've hit your usage limit`). Fall back to another family, never to a second Claude and call it cross-model. |
| Meta Muse Code 1.3 | `muse exec --workspace <repo> --approval-mode never --prompt-file <brief>` | ~7 min | Sandbox on by default. An untrusted workspace skips `AGENTS.md` and project skills — good for isolation. Clean stdout. |
| Xiaomi MiMo via opencode 2 | `opencode2 run --agent plan -m opencode-go/mimo-v2.6-pro "$(cat <brief>)"` | ~36 min | `plan` agent is read-only. Slow; give it >= 45 min. The run lives in opencode's background service: if the client times out, the session still finishes — recover the text with `opencode2 session list` then `opencode2 session export <id>` (last `assistant` message, `text` part). `--session` continuation prompts after a client timeout were not recorded. |

Re-measured 2026-09-23 (lask 2.1 review, same machine):

| Reviewer | Result |
|---|---|
| Codex CLI 0.151.0 on a ChatGPT account | Unusable. Config model `gpt-6-astra`: 400 "requires a newer version of Codex". `-m gpt-6-sol`: 400 "not supported when using Codex with a ChatGPT account". Upgrade the CLI or switch the account before relying on `lask:second-opinion`. Re-run 2026-09-23 later: the config model `gpt-6-astra` was accepted and stopped only at the usage limit (reset 2026-09-24 18:20); `-m gpt-6-sol` still 400 on a ChatGPT account, so on such an account leave `-m` out. |
| Gemini CLI 0.52.0 | Unusable: `IneligibleTierError` (the free Code Assist tier no longer serves this client). Headless also needs `--skip-trust`; `--approval-mode plan` is its read-only mode. |
| opencode 1.18.32 (`opencode`, not `opencode2`) | `opencode run --agent plan -m opencode-go/kimi-k3 "$(cat <brief>)"` and `-m opencode-go/glm-5.3` both pass the smoke test. `opencode-go/deepseek-v4-pro` needs "Global" region in the workspace privacy settings. The `plan` agent auto-rejects reads outside the workspace, so put the brief and the spec inside the repository (a git-ignored folder) or the run ends at the first rejected read. |

opencode Go reviewers, measured 2026-09-23 on a seeded-defect benchmark: a commit that
claims to be a pure refactor of a 378-line lease/fencing module (`case_store.py`), two
rounds of 8 planted behavior changes each; round 2 also had 4 equivalent rewrites as traps.
Same brief as `lask:reviewer`, `opencode2 run --agent plan -m opencode-go/<model> "$(cat <brief>)"`,
all models in parallel, one run each.

| Reviewer | Round 1 | Round 2 | Round 2 wall clock | Notes |
|---|---|---|---|---|
| Claude `lask:reviewer` | 8/8 | 8/8 | ~1.5 min | Also caught the append-only trigger turning one change into a crash. |
| `glm-5.3-flash` | 8/8 | 8/8 | 2 min | **opencode standard**, and the fallback when Codex reports `QUOTA-STOP`. Cheapest in the Go lineup ($0.15/$0.50 per M). |
| `mimo-v2.6-pro` | 8/8 | 8/8 | 11 min | Backup; slow but complete. |
| `openrouter/openai/gpt-6-sol#high` (opencode2 + OpenRouter) | — | 8/8 | 3 min | Also caught the append-only trigger, and ran Python in the workspace to check `Jsonb(None)`. `#high` is a real variant: an unknown one fails with `Variant unavailable`. Pay-per-token; cost per review not measured. The Codex family without the Codex CLI quota. |
| `glm-5.3` | 8/8 | 7/8 | 9 min | Saw the `date` change but ruled it out ("no date columns"). |
| `kimi-k3` | 8/8 | 7/8 | 7.5 min | Same demotion as glm-5.3; round 1 findings lacked path:line; priciest ($3/$15). |
| `minimax-m3` | — | 7/8 | 3 min | Argued `Jsonb(evidence)` vs `Jsonb(evidence or {})` was equivalent — a confident miss. |
| `qwen3.8-max` | 8/8 | failed | 20 min | Wandered into PostgreSQL source, then `Go usage limit exceeded` for the whole plan. |
| `qwen3.8-flash` | — | failed | 10 min | Ran `type C:\Program Files\PostgreSQL\...\pg_hba.conf` — outside the workspace — then HTTP 400. |
| `deepseek-v4.1-flash` | failed | — | — | Needs "Global" region in the Go workspace privacy settings. |

No reviewer found a defect Claude missed and none flagged a trap, so on this benchmark
the second family buys independence, not extra recall. Two cautions: the `plan` agent
is not a sandbox — it will run shell commands that read outside the workspace — and one
reviewer that goes down a rabbit hole can spend the whole Go quota, so time-box it
(`timeout 1200`) rather than giving it the 45 minutes MiMo once needed. Only `opencode2`
held the Go login in this run; `opencode auth list` showed 0 credentials.

Before a batch, smoke-test each CLI on a one-line question about a file in the repo
(e.g. "reply with the cmd value on line 3 of X") — it proves auth, workspace access
and output capture in under a minute.
