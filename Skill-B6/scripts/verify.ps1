$ErrorActionPreference = 'Stop'
$RootDir = Split-Path -Parent $PSScriptRoot
Set-Location $RootDir

function Invoke-Checked {
  param([scriptblock]$Cmd, [string]$Label)
  & $Cmd
  if ($LASTEXITCODE -ne 0) {
    throw "$Label failed with exit code $LASTEXITCODE"
  }
}

$VenvPy = Join-Path $RootDir ".venv\Scripts\python.exe"
$SkillDir = Join-Path $RootDir "vendor\stickman-video-director\skills\directing-stickman-videos"
$CompatDir = Join-Path $RootDir "scripts\ffmpeg-compat"
$RealFfmpeg = (Get-Command ffmpeg.exe | Where-Object { $_.Source -notlike "*ffmpeg-compat*" } | Select-Object -First 1).Source

$env:B6_REAL_FFMPEG = $RealFfmpeg
$env:PATH = "$CompatDir;$(Split-Path -Parent $VenvPy);$env:PATH"
$env:B6_PYTHON = $VenvPy
$env:PYTHONUTF8 = "1"
$env:PYTHONDONTWRITEBYTECODE = "1"
$env:PYTHONPYCACHEPREFIX = Join-Path $RootDir "workspace\cache\pycache"

Write-Host "=== 1. B6 Doctor & Pack Check ==="
Push-Location $SkillDir
try {
  Invoke-Checked { node scripts/autopilot.mjs doctor --style B6 --python $VenvPy } "B6 doctor"
  Invoke-Checked { node scripts/b6-dynamic-meme.mjs check-pack } "B6 check-pack"
} finally {
  Pop-Location
}

Write-Host "=== 2. Build & Unit/Integration Tests ==="
Invoke-Checked { npm run build } "Workspace build"
Invoke-Checked { npm --workspace=app/server run test } "Server tests"

Write-Host "=== 3. Playwright E2E Tests ==="
Invoke-Checked { npm --workspace=app/frontend run test:e2e } "Playwright E2E"

Write-Host "`nAll verification checks passed!"
