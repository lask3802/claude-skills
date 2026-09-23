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
| Codex CLI 0.151.0 on a ChatGPT account | Unusable. Config model `gpt-6-astra`: 400 "requires a newer version of Codex". `-m gpt-6-sol`: 400 "not supported when using Codex with a ChatGPT account". Upgrade the CLI or switch the account before relying on `lask:second-opinion`. |
| Gemini CLI 0.52.0 | Unusable: `IneligibleTierError` (the free Code Assist tier no longer serves this client). Headless also needs `--skip-trust`; `--approval-mode plan` is its read-only mode. |
| opencode 1.18.32 (`opencode`, not `opencode2`) | `opencode run --agent plan -m opencode-go/kimi-k3 "$(cat <brief>)"` and `-m opencode-go/glm-5.3` both pass the smoke test. `opencode-go/deepseek-v4-pro` needs "Global" region in the workspace privacy settings. The `plan` agent auto-rejects reads outside the workspace, so put the brief and the spec inside the repository (a git-ignored folder) or the run ends at the first rejected read. |

Before a batch, smoke-test each CLI on a one-line question about a file in the repo
(e.g. "reply with the cmd value on line 3 of X") — it proves auth, workspace access
and output capture in under a minute.
