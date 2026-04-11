#!/usr/bin/env bash
# Sync agent-workflow.md to AGENTS.md in all managed repos.
#
# Usage: ./scripts/sync-workflow.sh
#
# This script:
# 1. Reads docs/agent-workflow.md (the single source of truth)
# 2. For each repo, updates the <!-- BEGIN/END SYNCED WORKFLOW --> section in AGENTS.md
# 3. Creates a branch, commits, and opens a PR
#
# Requires: gh CLI authenticated with repo access

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKFLOW_FILE="$SCRIPT_DIR/../docs/agent-workflow.md"
REPOS=(star-rewards nutri-e fast-e count-e drink-e heart-e cutie automate-e conductor-e)
BRANCH="chore/sync-agent-workflow"
COMMIT_MSG="docs: sync agent workflow from automate-e"

if [[ ! -f "$WORKFLOW_FILE" ]]; then
  echo "Error: $WORKFLOW_FILE not found"
  exit 1
fi

WORKFLOW_CONTENT=$(cat "$WORKFLOW_FILE")

for repo in "${REPOS[@]}"; do
  echo "=== $repo ==="

  # Check if AGENTS.md exists
  existing=$(gh api "repos/Stig-Johnny/$repo/contents/AGENTS.md" --jq '.content' 2>/dev/null || echo "")

  if [[ -z "$existing" ]]; then
    # No AGENTS.md — create one with just the workflow section
    new_content="# AGENTS.md

<!-- BEGIN SYNCED WORKFLOW — do not edit below, run automate-e/scripts/sync-workflow.sh -->
${WORKFLOW_CONTENT}
<!-- END SYNCED WORKFLOW -->"
  else
    # Decode existing content
    decoded=$(echo "$existing" | base64 -d)

    if echo "$decoded" | grep -q "BEGIN SYNCED WORKFLOW"; then
      # Replace between markers
      new_content=$(echo "$decoded" | sed '/<!-- BEGIN SYNCED WORKFLOW/,/<!-- END SYNCED WORKFLOW/c\
<!-- BEGIN SYNCED WORKFLOW — do not edit below, run automate-e/scripts/sync-workflow.sh -->\
WORKFLOW_PLACEHOLDER\
<!-- END SYNCED WORKFLOW -->')
      # sed can't handle multiline replacement well, use python
      new_content=$(python3 -c "
import sys
content = sys.stdin.read()
print(content.replace('WORKFLOW_PLACEHOLDER', open('$WORKFLOW_FILE').read()))
" <<< "$new_content")
    else
      # No markers — append workflow section
      new_content="${decoded}

<!-- BEGIN SYNCED WORKFLOW — do not edit below, run automate-e/scripts/sync-workflow.sh -->
${WORKFLOW_CONTENT}
<!-- END SYNCED WORKFLOW -->"
    fi
  fi

  # Create branch from main
  main_sha=$(gh api "repos/Stig-Johnny/$repo/git/ref/heads/main" --jq '.object.sha')

  # Check if branch exists, delete if so
  gh api "repos/Stig-Johnny/$repo/git/refs/heads/$BRANCH" --jq '.ref' 2>/dev/null && \
    gh api "repos/Stig-Johnny/$repo/git/refs/heads/$BRANCH" -X DELETE 2>/dev/null || true

  gh api "repos/Stig-Johnny/$repo/git/refs" -X POST \
    -f ref="refs/heads/$BRANCH" -f sha="$main_sha" --silent 2>/dev/null

  # Get existing file SHA if it exists
  file_sha=$(gh api "repos/Stig-Johnny/$repo/contents/AGENTS.md" --jq '.sha' 2>/dev/null || echo "")

  # Upload file
  encoded=$(echo "$new_content" | base64)
  if [[ -n "$file_sha" ]]; then
    gh api "repos/Stig-Johnny/$repo/contents/AGENTS.md" -X PUT \
      -f message="$COMMIT_MSG" -f content="$encoded" \
      -f sha="$file_sha" -f branch="$BRANCH" --silent 2>/dev/null
  else
    gh api "repos/Stig-Johnny/$repo/contents/AGENTS.md" -X PUT \
      -f message="$COMMIT_MSG" -f content="$encoded" \
      -f branch="$BRANCH" --silent 2>/dev/null
  fi

  # Create PR
  gh pr create --repo "Stig-Johnny/$repo" \
    --head "$BRANCH" --base main \
    --title "$COMMIT_MSG" \
    --body "Synced from [automate-e/docs/agent-workflow.md](https://github.com/Stig-Johnny/automate-e/blob/main/docs/agent-workflow.md)." 2>&1

  echo ""
done

echo "Done. PRs created for all repos."
echo "To merge all: for repo in ${REPOS[*]}; do gh pr merge $BRANCH --repo Stig-Johnny/\$repo --squash --delete-branch --admin; done"
