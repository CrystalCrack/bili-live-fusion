$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$extensionPath = Join-Path $projectRoot 'extension'
$destination = Join-Path $projectRoot 'three-way-fusion-edge.zip'
Push-Location $projectRoot
try {
    & node scripts/check.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Extension checks failed.' }
    & node --test 'tests/*.test.mjs'
    if ($LASTEXITCODE -ne 0) { throw 'Tests failed.' }
    Compress-Archive -Path (Join-Path $extensionPath '*') -DestinationPath $destination -Force
    Write-Output "Created: $destination"
} finally { Pop-Location }
