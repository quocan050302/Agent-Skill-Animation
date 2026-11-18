param(
  [switch]$SkipClone
)

$ErrorActionPreference = 'Stop'
$RootDir = Split-Path -Parent $PSScriptRoot
Set-Location $RootDir

Write-Host "=== B6 Local Studio Setup (Windows) ==="
Write-Host "App Root: $RootDir"

# 1. Check Toolchain
$nodeVer = (node -v).Trim()
$nodeMajor = [int]($nodeVer.TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 20) { throw "Node.js >= 20 required (found $nodeVer)" }
Write-Host "Node.js: $nodeVer"

$pyVer = (python --version 2>&1)
Write-Host "Python : $pyVer"

$ffVer = (ffmpeg -version 2>&1 | Select-Object -First 1)
if (-not $ffVer) { throw "FFmpeg not found in PATH" }
Write-Host "FFmpeg : $ffVer"

# 2. Disk Space Guardrail (>= 6 GiB free before clone)
$driveLetter = (Get-Item $RootDir).PSDrive.Name
$freeGiB = [math]::Round(((Get-PSDrive $driveLetter).Free / 1GB), 2)
Write-Host "Disk Free ($($driveLetter):): $freeGiB GiB"
if ($freeGiB -lt 6) { throw "Insufficient free disk space (< 6 GiB). Aborting setup." }
if ($freeGiB -lt 10) { Write-Warning "Free disk space is below 10 GiB; large video renders may run low." }

# 3. Clone upstream stickman-video-director pinned to upstream-lock.json
$LockPath = Join-Path $RootDir "upstream-lock.json"
if (-not (Test-Path $LockPath)) { throw "Missing upstream-lock.json at $LockPath" }
$Lock = Get-Content $LockPath -Raw | ConvertFrom-Json
$VendorDir = Join-Path $RootDir "vendor\stickman-video-director"
$SkillDir = Join-Path $VendorDir ($Lock.skillSubdir -replace '/', '\')
if (-not $SkipClone -and -not (Test-Path "$VendorDir\.git")) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $VendorDir) | Out-Null
  for ($i = 1; $i -le 3; $i++) {
    Write-Host "Cloning stickman-video-director pinned at $($Lock.commitSha) (attempt $i)..."
    if (Test-Path $VendorDir) { Remove-Item -Recurse -Force $VendorDir }
    git -c http.version=HTTP/1.1 -c http.postBuffer=524288000 clone --no-checkout $Lock.repoUrl $VendorDir
    if ($LASTEXITCODE -eq 0 -and (Test-Path "$VendorDir\.git")) { break }
    Start-Sleep -Seconds 3
  }
  if (-not (Test-Path "$VendorDir\.git")) { throw "Failed to clone stickman-video-director" }
}

# Ensure LF line endings and exact pinned commit SHA in vendor checkout
Push-Location $VendorDir
git config core.autocrlf false
git config core.eol lf
$curHead = (git rev-parse HEAD 2>$null)
if ($curHead -ne $Lock.commitSha) {
  git fetch origin $Lock.commitSha
  git checkout -B $Lock.branch $Lock.commitSha
}
$dirty = git status --porcelain
if ($dirty) {
  git reset --hard $Lock.commitSha
}
$Sha = (git rev-parse HEAD).Trim()
if ($Sha -ne $Lock.commitSha) {
  Pop-Location
  throw "Vendor SHA mismatch: expected $($Lock.commitSha), got $Sha"
}
Write-Host "Vendor SHA (pinned): $Sha"
Pop-Location

# 4. Install vendor Node dependencies
Push-Location $SkillDir
npm ci
Pop-Location

# 5. Setup Python .venv with pinned upstream B6 requirements
$VenvDir = Join-Path $RootDir ".venv"
$VenvPy = Join-Path $VenvDir "Scripts\python.exe"
if (-not (Test-Path $VenvPy)) {
  python -m venv $VenvDir
}
Copy-Item -Force $VenvPy (Join-Path $VenvDir "Scripts\python3.exe")
& $VenvPy -m pip install --upgrade pip
$ReqFile = Join-Path $SkillDir "assets\b6\hong-kong-v90\requirements.txt"
& $VenvPy -m pip install --only-binary=:all: -r $ReqFile
& $VenvPy -c "import numpy, PIL, cv2; print('Python B6 imports OK:', numpy.__version__, PIL.__version__, cv2.__version__)"

# 6. Build FFmpeg 9 compatibility shim if needed
$CompatDir = Join-Path $RootDir "scripts\ffmpeg-compat"
$CompatExe = Join-Path $CompatDir "ffmpeg.exe"
$Csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $CompatExe) -and (Test-Path $Csc) -and (Test-Path "$CompatDir\ffmpeg_compat.cs")) {
  & $Csc /nologo /optimize+ /out:$CompatExe "$CompatDir\ffmpeg_compat.cs"
}

# 7. Install and build B6 Local Studio app
npm install
npm run build

# 8. Run B6 Doctor
$env:B6_PYTHON = $VenvPy
$env:PYTHONDONTWRITEBYTECODE = "1"
$env:PYTHONPYCACHEPREFIX = Join-Path $RootDir "workspace\cache\pycache"
Push-Location $SkillDir
node scripts/autopilot.mjs doctor --style B6 --python $VenvPy
node scripts/b6-dynamic-meme.mjs check-pack
Pop-Location

# 9. Hydrate & verify .gitignored upstream engine/fonts/reference into workspace projects
node "$RootDir\scripts\hydrate-project.mjs" --all
if ($LASTEXITCODE -ne 0) { throw "Project hydration failed" }

Write-Host "`nSetup completed successfully!"
