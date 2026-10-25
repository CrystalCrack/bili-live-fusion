param([switch]$SkipTests)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$extensionPath = Join-Path $projectRoot 'extension'
$manifest = Get-Content (Join-Path $extensionPath 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$destination = Join-Path $projectRoot ("bili-live-fusion-edge-{0}.zip" -f $manifest.version)
Push-Location $projectRoot
try {
    & node scripts/check.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Extension checks failed.' }
    if (-not $SkipTests) {
        & node --test 'tests/*.test.mjs'
        if ($LASTEXITCODE -ne 0) { throw 'Tests failed.' }
    }
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $packageStream = [System.IO.File]::Open($destination, [System.IO.FileMode]::Create)
    $archive = New-Object System.IO.Compression.ZipArchive($packageStream, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($file in Get-ChildItem -LiteralPath $extensionPath -Recurse -File) {
            $entryName = $file.FullName.Substring($extensionPath.Length + 1).Replace([char]92, [char]47)
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $entryName, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
        }
    } finally { $archive.Dispose(); $packageStream.Dispose() }
    Write-Output "Created: $destination"
} finally { Pop-Location }
