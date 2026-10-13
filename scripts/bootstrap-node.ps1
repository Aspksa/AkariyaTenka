# Installs a checksum-verified portable Node.js runtime into <project>\.runtime\node.
# No administrator rights and no global PATH changes are required.
param(
  [Parameter(Mandatory = $true)][string]$Dest,
  [string]$Version = "22.23.3"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Get-NodeArchitecture {
  $archText = "$env:PROCESSOR_ARCHITECTURE $env:PROCESSOR_ARCHITEW6432".ToUpperInvariant()
  if ($archText -match "ARM64") { return "arm64" }
  if ($archText -match "AMD64|X86") { return "x64" }
  throw "Unsupported Windows architecture: $archText"
}

$arch = Get-NodeArchitecture
$name = "node-v$Version-win-$arch"
$archive = "$name.zip"
$baseUrl = "https://nodejs.org/dist/v$Version"
$runtimeDir = [IO.Path]::GetFullPath($Dest)
$zipPath = Join-Path $runtimeDir $archive
$extractDir = Join-Path $runtimeDir "_extract"
$targetDir = Join-Path $runtimeDir "node"

New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null

try {
  Write-Host "Downloading official Node.js $Version ($arch)..."
  Invoke-WebRequest -Uri "$baseUrl/$archive" -OutFile $zipPath -UseBasicParsing
  $sumsResponse = Invoke-WebRequest -Uri "$baseUrl/SHASUMS256.txt" -UseBasicParsing
  $checksumLine = ($sumsResponse.Content -split "`r?`n") |
    Where-Object { $_ -match "\s+\*?$([Regex]::Escape($archive))\s*$" } |
    Select-Object -First 1

  if (-not $checksumLine) { throw "Official SHA-256 checksum for $archive was not found." }
  $expected = (($checksumLine.Trim() -split "\s+")[0]).ToLowerInvariant()
  if ($expected -notmatch "^[0-9a-f]{64}$") { throw "Official checksum entry for $archive is invalid." }

  $actual = (Get-FileHash -Path $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $expected) {
    Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
    throw "SHA-256 checksum mismatch. The downloaded archive was deleted."
  }

  if (Test-Path -LiteralPath $extractDir) { Remove-Item -LiteralPath $extractDir -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $extractDir | Out-Null
  Expand-Archive -LiteralPath $zipPath -DestinationPath $extractDir -Force

  $extractedDir = Join-Path $extractDir $name
  $extractedNode = Join-Path $extractedDir "node.exe"
  if (-not (Test-Path -LiteralPath $extractedNode -PathType Leaf)) { throw "Portable Node.js archive did not contain node.exe." }

  $installedVersion = (& $extractedNode -p "process.versions.node").Trim()
  if ($LASTEXITCODE -ne 0 -or $installedVersion -ne $Version) {
    throw "Extracted Node.js version verification failed. Expected $Version, got $installedVersion."
  }

  if (Test-Path -LiteralPath $targetDir) { Remove-Item -LiteralPath $targetDir -Recurse -Force }
  Move-Item -LiteralPath $extractedDir -Destination $targetDir
  Write-Host "Portable Node.js ready: $targetDir"
}
finally {
  if (Test-Path -LiteralPath $extractDir) { Remove-Item -LiteralPath $extractDir -Recurse -Force -ErrorAction SilentlyContinue }
  if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue }
}
