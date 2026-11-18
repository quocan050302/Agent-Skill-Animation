param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$ForwardArgs
)

$ErrorActionPreference = 'Stop'
$RootDir = Split-Path -Parent $PSScriptRoot
Push-Location $RootDir
try {
  if ($ForwardArgs -and $ForwardArgs.Count -gt 0) {
    node "$RootDir\scripts\hydrate-project.mjs" @ForwardArgs
  } else {
    node "$RootDir\scripts\hydrate-project.mjs" --all
  }
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Pop-Location
}
