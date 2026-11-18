# Safe Windows PowerShell setup script for Skill-Cartoon-Short
# Avoids hardcoded drive letters, global /tmp deletions, and privileged symlinks.
param(
  [string]$KitPath = $env:CARTOON_SHORT_KIT_ZIP
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path (Join-Path $ScriptDir "..\..")

Push-Location $ProjectRoot
try {
  if (-not (Test-Path "node_modules\three") -or -not (Test-Path "node_modules\playwright")) {
    npm ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) {
      npm install --no-audit --no-fund
    }
  }

  if ($KitPath -and $KitPath.Length -gt 0) {
    node tools/setup/hydrate.mjs --kit "$KitPath"
  } else {
    node tools/setup/hydrate.mjs
  }
  if ($LASTEXITCODE -ne 0) {
    throw "Hydration failed with exit code $LASTEXITCODE"
  }
} finally {
  Pop-Location
}
