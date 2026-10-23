# nudger project rules

## Destructive commands: absolute ban

- Never run `git reset --hard`, `git clean -f/-d/-x`, `git checkout -- <path>`, `git checkout .`, `git restore <path>` without `--staged`, `git rm -r/-f` without `--cached`, `git stash drop/clear`, `git branch -D`, `git push --force`, `git reflog expire`, `git gc --prune`, `git prune`, `git filter-branch`, `git filter-repo`, `git worktree remove --force`, or `rm -r/-rf` unless tk asks for that exact operation in the current turn.
- To unstage, use `git restore --staged <path>`. Never reset.
- Before any history rewrite, cleanup, or ambiguous git operation, make an external backup and verify it, e.g. `tar --exclude=node_modules --exclude=.git -czf /c/tmp/nudger-backup-$(date +%Y%m%d-%H%M).tgz .`
- First-time repo setup: create `.gitignore`, make an initial commit, then continue. Never use `--hard` before a commit exists.
- Pi sessions are additionally guarded by `~/.pi/agent/extensions/git-guard/`. The override `GIT_ALLOW_DESTRUCTIVE=1` is only for a deliberate, backed-up, user-approved operation.
- A guard is not a backup. Keep exports and external snapshots.

On 2026-10-22 a `git reset --hard` in an unborn repo deleted this project's working tree. It was recovered from git blobs; do not repeat it.

## Commands that work in git-bash

npm script shims churn in this shell, so call the binaries through node directly from the project root:

- typecheck: `node node_modules/typescript/bin/tsc --noEmit`
- tests: `node node_modules/vitest/vitest.mjs run` (add a path to run one file)
- build: `node node_modules/vite/bin/vite.js build`

`dist/` is gitignored and rebuilt by the Pages workflow.
