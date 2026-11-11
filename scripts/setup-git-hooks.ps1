# Run from the repository root on Windows PowerShell with Git for Windows installed.
$ErrorActionPreference = 'Stop'
$repo = git rev-parse --show-toplevel 2>$null
if ($LASTEXITCODE -ne 0 -or -not $repo) { throw 'Not a Git repository. Run git init first.' }
Set-Location $repo.Trim()
if (-not (Test-Path '.githooks/pre-commit')) { throw 'Missing .githooks/pre-commit' }
if (-not (Test-Path '.githooks/commit-msg')) { throw 'Missing .githooks/commit-msg' }
git config --local core.hooksPath '.githooks'
if ($LASTEXITCODE -ne 0) { throw 'Could not configure core.hooksPath' }
Write-Host 'Installed repository-local hooks path: ' (git config --local --get core.hooksPath)
Write-Host 'Each commit must stage exactly one changed path and have type(scope): subject.'
Write-Host 'Test: stage two temporary files and confirm a commit is rejected; unstage before continuing.'
