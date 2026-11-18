param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$ForwardArgs
)

$ErrorActionPreference = 'Stop'
$RootDir = Split-Path -Parent $PSScriptRoot
Set-Location $RootDir

$VenvPy = Join-Path $RootDir ".venv\Scripts\python.exe"
$CompatDir = Join-Path $RootDir "scripts\ffmpeg-compat"
$RealFfmpeg = (Get-Command ffmpeg.exe | Where-Object { $_.Source -notlike "*ffmpeg-compat*" } | Select-Object -First 1).Source

$env:B6_REAL_FFMPEG = $RealFfmpeg
$env:PATH = "$CompatDir;$(Split-Path -Parent $VenvPy);$env:PATH"
$env:B6_PYTHON = $VenvPy
$env:PYTHONUTF8 = "1"
$env:PYTHONDONTWRITEBYTECODE = "1"
$env:PYTHONPYCACHEPREFIX = Join-Path $RootDir "workspace\cache\pycache"

Write-Host "=== B6 Local Studio Bounded-Parallel DAG Verification ==="
if ($ForwardArgs -and $ForwardArgs.Count -gt 0) {
  node "$RootDir\scripts\verify-all.mjs" @ForwardArgs
} else {
  node "$RootDir\scripts\verify-all.mjs" --max-workers 2
}
if ($LASTEXITCODE -ne 0) {
  throw "verify-all.mjs failed with exit code $LASTEXITCODE"
}

Write-Host "`nAll verification checks passed!"
