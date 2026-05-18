<#
.SYNOPSIS
  Runs any command with CUDA 11.8 prepended to PATH/CUDA_PATH only for
  this process. Global environment stays untouched.

.DESCRIPTION
  After scripts\setup-cuda.ps1 finishes, multiple CUDA versions live
  side-by-side under C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\.
  Whichever the installer wrote to the system PATH last wins by default.
  This wrapper forces CUDA 11.8 to the front for the duration of the
  spawned process and its children, then exits — your shell and other
  tools keep seeing whatever CUDA they saw before.

.EXAMPLE
  .\scripts\run-with-cuda118.ps1 npm run train:gpu
  .\scripts\run-with-cuda118.ps1 npx ts-node src/main.ts train --device=gpu
  .\scripts\run-with-cuda118.ps1 nvcc --version
#>

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Command,

  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Arguments
)

$ErrorActionPreference = "Stop"

$ToolkitRoot = "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v11.8"
if (-not (Test-Path (Join-Path $ToolkitRoot "bin"))) {
  Write-Host "[ERROR] CUDA 11.8 toolkit not found at $ToolkitRoot." -ForegroundColor Red
  Write-Host "        Run .\scripts\setup-cuda.ps1 first." -ForegroundColor Red
  exit 1
}

$env:CUDA_PATH = $ToolkitRoot
$env:CUDA_PATH_V11_8 = $ToolkitRoot
$env:PATH = (Join-Path $ToolkitRoot "bin") + ";" + (Join-Path $ToolkitRoot "libnvvp") + ";" + $env:PATH

Write-Host "[CUDA] Using $ToolkitRoot (scoped to this process)" -ForegroundColor Cyan

& $Command @Arguments
exit $LASTEXITCODE
