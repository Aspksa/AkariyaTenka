param(
  [Parameter(Mandatory = $true)][string]$Archive,
  [Parameter(Mandatory = $true)][string]$Destination
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$base = [IO.Path]::GetFullPath($Destination).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
$zip = [IO.Compression.ZipFile]::OpenRead($Archive)
try {
  if ($zip.Entries.Count -gt 10000) { throw "GitHub ZIP has too many entries" }
  $total = [long]0
  $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($entry in $zip.Entries) {
    $name = $entry.FullName
    if ([string]::IsNullOrWhiteSpace($name) -or $name.Contains("\") -or $name.Contains(":") -or $name.StartsWith("/") -or
        $name -match '(^|/)(\.|\.\.)(/|$)' -or $name -match '(^|/)[^/]*[. ](/|$)') {
      throw "Unsafe ZIP entry"
    }
    $segments = $name.TrimEnd('/').Split('/')
    foreach ($segment in $segments) {
      if ($segment -match '^(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)' -or
          $segment -match '[<>""|?*\x00-\x1F]') { throw "Invalid Windows ZIP entry name" }
    }
    if (-not $seen.Add($name.TrimEnd('/'))) { throw "Duplicate ZIP path" }
    $unixMode = ($entry.ExternalAttributes -shr 16) -band 0xF000
    if ($unixMode -eq 0xA000) { throw "Symlink ZIP entry forbidden" }
    $total += $entry.Length
    if ($entry.Length -gt 40000000 -or $total -gt 150000000) { throw "ZIP payload too large" }
    $target = [IO.Path]::GetFullPath((Join-Path $base ($name -replace '/', [IO.Path]::DirectorySeparatorChar)))
    if (-not $target.StartsWith($base, [StringComparison]::OrdinalIgnoreCase)) { throw "ZIP escapes staging root" }
  }
  foreach ($entry in $zip.Entries) {
    $target = [IO.Path]::GetFullPath((Join-Path $base ($entry.FullName -replace '/', [IO.Path]::DirectorySeparatorChar)))
    if ($entry.FullName.EndsWith('/')) {
      [IO.Directory]::CreateDirectory($target) | Out-Null
    } else {
      [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
      [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $false)
    }
  }
} finally { $zip.Dispose() }
