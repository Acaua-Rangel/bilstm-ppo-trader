<#
.SYNOPSIS
  Installs CUDA Toolkit 11.8 side-by-side with whatever is already present,
  without touching the NVIDIA display driver.

.DESCRIPTION
  @tensorflow/tfjs-node-gpu 4.x is built against CUDA 11.8 + cuDNN 8.6.
  This script:
    1. Verifies an NVIDIA driver is present (refuses to install one — drivers
       are too coupled to your monitor/OS and you should manage them yourself).
    2. Downloads the CUDA 11.8 local installer to .\scripts\cuda-downloads\.
    3. Runs the installer silently with ONLY the runtime components needed
       by tfjs-node-gpu — no Display.Driver, no Visual Studio integration,
       no Nsight. So an existing CUDA toolkit and the current driver stay
       untouched. Multiple CUDA versions can coexist; NVIDIA installs them
       under separate v11.x / v12.x folders by design.
    4. Prompts the user to download cuDNN 8.6 manually (cuDNN requires an
       NVIDIA developer login, which cannot be automated) and extracts it
       into the v11.8 toolkit folder when supplied with -CudnnZip <path>.
    5. Verifies the install by checking nvcc/cudart presence.

  After install, use scripts\run-with-cuda118.ps1 to launch any command
  with CUDA 11.8 prepended to PATH only for that process. Your global
  CUDA setup stays as it is.

.PARAMETER CudnnZip
  Optional. Path to the cuDNN 8.6.0 for CUDA 11.x Windows ZIP that you
  downloaded manually from https://developer.nvidia.com/rdp/cudnn-archive.
  When provided, the script extracts it into the CUDA 11.8 toolkit folder.

.PARAMETER SkipDownload
  Skip downloading the CUDA installer (assume it's already in
  .\scripts\cuda-downloads\). Useful when re-running after a partial setup.

.EXAMPLE
  .\scripts\setup-cuda.ps1
  .\scripts\setup-cuda.ps1 -CudnnZip "C:\Downloads\cudnn-windows-x86_64-8.6.0.163_cuda11-archive.zip"
#>

[CmdletBinding()]
param(
  [string]$CudnnZip,
  [switch]$SkipDownload
)

$ErrorActionPreference = "Stop"

# --- Constants ---------------------------------------------------------------

$CudaVersion       = "11.8.0"
$CudaShortVersion  = "v11.8"
$BundledDriverVer  = "522.06"
$InstallerName     = "cuda_${CudaVersion}_${BundledDriverVer}_windows.exe"
$InstallerUrl      = "https://developer.download.nvidia.com/compute/cuda/${CudaVersion}/local_installers/${InstallerName}"
$InstallerSha256   = "524F9C4ADF61664CC4257AF21C0EB54AE05C0FCBE74F19B7AC4CCC81A0C8A57F"

$ToolkitRoot       = "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\${CudaShortVersion}"
$DownloadDir       = Join-Path $PSScriptRoot "cuda-downloads"
$InstallerPath     = Join-Path $DownloadDir $InstallerName

# Components tfjs-node-gpu actually links against. Anything else (driver,
# devkit, Visual Studio integration, Nsight, etc.) is intentionally omitted.
$Components = @(
  "cudart_11.8",
  "cublas_11.8",
  "cufft_11.8",
  "curand_11.8",
  "cusolver_11.8",
  "cusparse_11.8",
  "nvrtc_11.8",
  "thrust_11.8"
)

# --- Helpers -----------------------------------------------------------------

function Write-Step([string]$message) {
  Write-Host "==> $message" -ForegroundColor Cyan
}

function Write-Warn([string]$message) {
  Write-Host "[WARN] $message" -ForegroundColor Yellow
}

function Write-Err([string]$message) {
  Write-Host "[ERROR] $message" -ForegroundColor Red
}

function Assert-DriverPresent {
  Write-Step "Checking for an existing NVIDIA driver"
  $smi = Get-Command nvidia-smi -ErrorAction SilentlyContinue
  if (-not $smi) {
    Write-Err "nvidia-smi not found. Install the NVIDIA driver from https://www.nvidia.com/Download/index.aspx first."
    Write-Err "This script refuses to manage drivers — they should be installed manually."
    throw "Missing NVIDIA driver."
  }
  $output = & nvidia-smi --query-gpu=driver_version,name --format=csv,noheader
  $first = ($output | Select-Object -First 1).Trim()
  $parts = $first -split ","
  $driver = $parts[0].Trim()
  $gpu = ($parts[1..($parts.Count - 1)] -join ",").Trim()
  Write-Host "    GPU      : $gpu"
  Write-Host "    Driver   : $driver"
  $driverMajor = [double]($driver -split "\.")[0]
  if ($driverMajor -lt 452) {
    Write-Warn "Driver $driver is older than 452.39 (CUDA 11.0 minimum). The toolkit will install, but runtime may fail until you update the driver."
  } else {
    Write-Host "    Driver is new enough for CUDA 11.x runtime (>= 452.39)." -ForegroundColor Green
  }
}

function Get-Installer {
  if ($SkipDownload) {
    if (-not (Test-Path $InstallerPath)) {
      throw "SkipDownload set but installer not found at $InstallerPath."
    }
    Write-Step "Skipping download (file present at $InstallerPath)"
    return
  }
  if (-not (Test-Path $DownloadDir)) {
    New-Item -ItemType Directory -Path $DownloadDir | Out-Null
  }
  if (Test-Path $InstallerPath) {
    Write-Step "Installer already downloaded — verifying SHA-256"
    if (Test-Sha256 $InstallerPath $InstallerSha256) {
      Write-Host "    Hash OK, reusing." -ForegroundColor Green
      return
    }
    Write-Warn "Hash mismatch — re-downloading."
    Remove-Item $InstallerPath -Force
  }
  Write-Step "Downloading $InstallerName (~3 GB, this takes a while)"
  Write-Host "    From: $InstallerUrl"
  Write-Host "    To  : $InstallerPath"
  # Force TLS 1.2 — older default on Win 10 PowerShell 5.1 can negotiate
  # downlevel and fail on NVIDIA's CDN.
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -Uri $InstallerUrl -OutFile $InstallerPath -UseBasicParsing
  Write-Step "Verifying SHA-256"
  if (-not (Test-Sha256 $InstallerPath $InstallerSha256)) {
    throw "SHA-256 mismatch after download. Re-run the script."
  }
  Write-Host "    Hash OK." -ForegroundColor Green
}

function Test-Sha256([string]$file, [string]$expected) {
  $actual = (Get-FileHash -Algorithm SHA256 -Path $file).Hash
  return ($actual -eq $expected.ToUpper())
}

function Install-Toolkit {
  if (Test-Path (Join-Path $ToolkitRoot "bin\cudart64_*.dll")) {
    Write-Step "CUDA 11.8 toolkit already installed at $ToolkitRoot — skipping installer"
    return
  }
  Write-Step "Running CUDA 11.8 silent install (no driver, no VS integration)"
  Write-Host "    Components: $($Components -join ', ')"
  # -s = silent; the explicit component list excludes Display.Driver and
  # everything else not listed. NVIDIA's installer puts the toolkit under
  # v11.8\, so any pre-existing v11.x / v12.x install is left alone.
  $args = @("-s") + $Components
  $proc = Start-Process -FilePath $InstallerPath -ArgumentList $args -Wait -PassThru
  if ($proc.ExitCode -ne 0) {
    throw "CUDA installer exited with code $($proc.ExitCode). Check %TEMP%\CUDA\ for logs."
  }
  if (-not (Test-Path (Join-Path $ToolkitRoot "bin"))) {
    throw "Install reported success but $ToolkitRoot\bin is missing. Re-run with elevation."
  }
  Write-Host "    Toolkit installed at $ToolkitRoot" -ForegroundColor Green
}

function Install-Cudnn {
  $cudnnReadme = Join-Path $ToolkitRoot "bin\cudnn64_8.dll"
  if (Test-Path $cudnnReadme) {
    Write-Step "cuDNN already present at $cudnnReadme — skipping"
    return
  }
  if (-not $CudnnZip) {
    Write-Step "cuDNN must be downloaded manually (NVIDIA login required)"
    Write-Host ""
    Write-Host "  1. Go to: https://developer.nvidia.com/rdp/cudnn-archive"
    Write-Host "  2. Sign in (free NVIDIA developer account)."
    Write-Host "  3. Pick: 'Download cuDNN v8.6.0 (October 3rd, 2022), for CUDA 11.x'"
    Write-Host "  4. Pick: 'Local Installer for Windows (Zip)'"
    Write-Host "  5. Re-run this script with: -CudnnZip <path-to-zip>"
    Write-Host ""
    Write-Warn "GPU will not work until cuDNN is in place."
    return
  }
  if (-not (Test-Path $CudnnZip)) {
    throw "CudnnZip not found: $CudnnZip"
  }
  Write-Step "Extracting cuDNN into $ToolkitRoot"
  $temp = Join-Path $env:TEMP "cudnn-extract"
  if (Test-Path $temp) { Remove-Item $temp -Recurse -Force }
  Expand-Archive -Path $CudnnZip -DestinationPath $temp -Force
  # The official ZIP layout is:
  #   cudnn-windows-x86_64-8.6.0.163_cuda11-archive\
  #     bin\*.dll
  #     include\*.h
  #     lib\x64\*.lib
  # Copy each subtree into the matching toolkit subfolder.
  $root = Get-ChildItem -Path $temp -Directory | Select-Object -First 1
  if (-not $root) { throw "Unexpected cuDNN ZIP layout in $CudnnZip" }
  Copy-Item -Path (Join-Path $root.FullName "bin\*")  -Destination (Join-Path $ToolkitRoot "bin")  -Force
  Copy-Item -Path (Join-Path $root.FullName "include\*") -Destination (Join-Path $ToolkitRoot "include") -Force
  Copy-Item -Path (Join-Path $root.FullName "lib\x64\*") -Destination (Join-Path $ToolkitRoot "lib\x64") -Force
  Remove-Item $temp -Recurse -Force
  Write-Host "    cuDNN installed into $ToolkitRoot" -ForegroundColor Green
}

function Test-Installation {
  Write-Step "Verifying installation"
  $cudart = Get-ChildItem -Path (Join-Path $ToolkitRoot "bin") -Filter "cudart64_*.dll" -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $cudart) {
    Write-Err "cudart not found — toolkit install incomplete."
    return $false
  }
  Write-Host "    cudart: $($cudart.Name)" -ForegroundColor Green
  $cudnn = Join-Path $ToolkitRoot "bin\cudnn64_8.dll"
  if (Test-Path $cudnn) {
    Write-Host "    cudnn : cudnn64_8.dll" -ForegroundColor Green
  } else {
    Write-Warn "cudnn64_8.dll missing — run again with -CudnnZip <path>."
    return $false
  }
  return $true
}

function Print-NextSteps([bool]$cudnnOk) {
  Write-Host ""
  Write-Step "Next steps"
  if (-not $cudnnOk) {
    Write-Host "  - Finish the cuDNN step above, then re-run this script with -CudnnZip <path>."
    return
  }
  Write-Host "  - Install the GPU TF.js package: npm install @tensorflow/tfjs-node-gpu"
  Write-Host "  - Launch via the project wrapper (keeps CUDA 11.8 PATH scoped):"
  Write-Host "      .\scripts\run-with-cuda118.ps1 npm run train:gpu"
  Write-Host "  - Or one-shot:"
  Write-Host "      .\scripts\run-with-cuda118.ps1 npx ts-node src/main.ts train --device=gpu"
}

# --- Main --------------------------------------------------------------------

Write-Host ""
Write-Host "CUDA 11.8 setup for @tensorflow/tfjs-node-gpu 4.x" -ForegroundColor White
Write-Host "----------------------------------------------------------" -ForegroundColor DarkGray

Assert-DriverPresent
Get-Installer
Install-Toolkit
Install-Cudnn
$ok = Test-Installation
Print-NextSteps $ok

Write-Host ""
Write-Host "Done." -ForegroundColor Green
