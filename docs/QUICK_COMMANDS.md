# Commands cheatsheet

## Windows / Git hooks

```powershell
git init
powershell -ExecutionPolicy Bypass -File scripts/setup-git-hooks.ps1
git config --get core.hooksPath
```

## One changed file = one commit

```bash
git status --short
git add -- docs/PRODUCT_SPEC.md
git diff --cached --name-status
git diff --cached --check
git commit -m "docs(spec): define windows agent requirements"
git show --stat --oneline HEAD
```

For next file do **another** `git add -- <single path>` and **another** commit. You may import the blueprint into the new repo and ask Antigravity to commit all tracked files in a loop, **one file at a time**, never a mass initial commit. If you have existing user changes, do NOT stage them accidentally.

## Blueprint validation

```powershell
python scripts/validate-blueprint.py
python scripts/verify-one-file-history.py 30
```

These tools audit blueprint and Git history only. They do **not** test the future Electron app.

## App commands to implement during M0

```bash
npm run dev
npm run typecheck
npm run lint
npm run test:unit -- --run
npm run test:ui -- --run
```

**Currently not available** — this package contains architecture and agent instructions, not application code.
