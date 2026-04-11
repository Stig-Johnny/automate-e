## Workflow

This section is synced from [automate-e/docs/agent-workflow.md](https://github.com/Stig-Johnny/automate-e/blob/main/docs/agent-workflow.md). Do not edit it here — changes will be overwritten. To update, edit the source and run `sync-workflow.sh`.

### Branch Convention

Always create a feature branch with the issue number:

```
git checkout -b feat/123-short-description
```

The issue number in the branch name links your work to the rig pipeline.

### Development Loop

1. **Read the issue** — `gh issue view <N>` for full context
2. **Create branch** — `git checkout -b feat/<N>-description`
3. **Implement** — write code, follow repo conventions
4. **Test locally** — run the repo's test command (see `.rig-agent.yaml`)
5. **Build** — run the repo's build command (see `.rig-agent.yaml`)
6. **Commit** — conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`
7. **Push and PR** — `git push -u origin HEAD && gh pr create --body "Closes #<N>"`

### After Creating a PR

Do NOT consider the task done after creating the PR. The pipeline continues:

1. **Report the PR** — `~/.claude/hooks/conductor-e-hook.sh PR_CREATED --pr <N> --url <url>`
2. **Wait for CI** — `gh pr checks <PR> --watch` or poll until checks complete
3. **If CI fails** — read the failure logs (`gh run view <run-id> --log-failed`), fix the code, push to the same branch. CI reruns automatically.
4. **Wait for review** — Review-E reviews all agent PRs automatically. Check: `gh pr view <PR> --json reviews --jq '.reviews[] | "\(.user.login): \(.state)"'`
5. **If changes requested** — read ALL review comments, address every one, push new commits to the same branch. Do NOT create a new PR.
6. **If approved** — the PR will be auto-merged by the auto-merge workflow. Do not merge manually.
7. **Done** — the issue is closed automatically when the PR merges (via `Closes #N` in the PR body).

### Iteration Rules

- Fix CI failures before requesting review
- Address ALL review comments, not just some
- Push to the existing branch — never force push, never create a new PR
- If stuck after 2 attempts, report: `~/.claude/hooks/conductor-e-hook.sh AGENT_STUCK`
- Maximum 3 CI fix iterations before escalating to a human

### Installing Tools at Runtime

If you need a tool that isn't installed, install it yourself:

- **Node.js:** `npm install -g <package>`
- **Python:** `pip install <package>`
- **System:** `sudo apt-get install -y <package>` (containers have sudo)
- **.NET:** `dotnet tool install -g <tool>`

Check `.rig-agent.yaml` for pre-declared tools — install those first.

### Reporting to Conductor-E

All developers and AI tools should report activity to the engineering rig:

```bash
# Start work (auto-detected on branch creation for Claude Code)
~/.claude/hooks/conductor-e-hook.sh WORK_STARTED

# Periodic heartbeat (auto for Claude Code, manual for other tools)
~/.claude/hooks/conductor-e-hook.sh HEARTBEAT working

# After creating PR
~/.claude/hooks/conductor-e-hook.sh PR_CREATED --pr 42 --url https://github.com/owner/repo/pull/42

# If stuck
~/.claude/hooks/conductor-e-hook.sh AGENT_STUCK

# Session end
~/.claude/hooks/conductor-e-hook.sh HEARTBEAT idle
```

Claude Code users: these events fire automatically via hooks in `~/.claude/settings.json`. Other AI tools: call the script directly or integrate via git hooks (`~/.claude/hooks/git-post-checkout.sh`).
