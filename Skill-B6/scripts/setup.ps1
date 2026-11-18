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

# 3. Clone upstream stickman-video-director if missing
$VendorDir = Join-Path $RootDir "vendor\stickman-video-director"
$SkillDir = Join-Path $VendorDir "skills\directing-stickman-videos"
if (-not $SkipClone -and -not (Test-Path "$VendorDir\.git")) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $VendorDir) | Out-Null
  for ($i = 1; $i -le 3; $i++) {
    Write-Host "Cloning stickman-video-director (attempt $i)..."
    if (Test-Path $VendorDir) { Remove-Item -Recurse -Force $VendorDir }
    git -c http.version=HTTP/1.1 -c http.postBuffer=524288000 clone --depth 1 --single-branch --branch main https://github.com/kaomei/stickman-video-director.git $VendorDir
    if ($LASTEXITCODE -eq 0 -and (Test-Path "$VendorDir\.git")) { break }
    Start-Sleep -Seconds 3
  }
  if (-not (Test-Path "$VendorDir\.git")) { throw "Failed to clone stickman-video-director" }
}

# Ensure LF line endings in vendor checkout so Windows byte SHA-256 checks match upstream
Push-Location $VendorDir
git config core.autocrlf false
git config core.eol lf
$dirty = git status --porcelain
if ($dirty) {
  git reset --hard HEAD
}
$Sha = git rev-parse HEAD
Write-Host "Vendor SHA: $Sha"
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

Write-Host "`nSetup completed successfully!"
