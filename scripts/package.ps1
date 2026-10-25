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
    Compress-Archive -Path (Join-Path $extensionPath '*') -DestinationPath $destination -Force
    Write-Output "Created: $destination"
} finally { Pop-Location }
