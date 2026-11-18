param(
  [switch]$Open,
  [switch]$Prod
)

$ErrorActionPreference = 'Stop'
$RootDir = Split-Path -Parent $PSScriptRoot
Set-Location $RootDir

$argsList = @("scripts/dev-runner.mjs")
if ($Prod) { $argsList += "--prod" }
if ($Open) { $argsList += "--open" }

node @argsList
