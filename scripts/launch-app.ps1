$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$exeCandidates = @(
    (Join-Path $root 'dist\win-unpacked\Enigma.exe'),
    (Join-Path $root 'dist2\win-unpacked\Enigma.exe'),
    (Join-Path $root 'dist\win-unpacked\Enigma Browser.exe'),
    (Join-Path $root 'dist2\win-unpacked\Enigma Browser.exe')
)
$exe = $exeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $exe) { $exe = $exeCandidates[0] }

# Kill any running instance so icon patch can apply
Get-Process | Where-Object {
    $_.Path -and ($_.Path -like '*enigma-browser*' -or $_.ProcessName -eq 'electron' -or $_.ProcessName -eq 'Enigma')
} | Stop-Process -Force -ErrorAction SilentlyContinue

Start-Sleep -Seconds 1

if (-not (Test-Path $exe)) {
    Write-Host 'First launch — building Enigma (~1 min)...' -ForegroundColor Cyan
    Push-Location $root
    npm run build:dir
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Pop-Location
    $exe = $exeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}

if (-not (Test-Path $exe)) {
    Write-Host 'Build failed.' -ForegroundColor Red
    exit 1
}

# Ensure icon is embedded
Push-Location $root
node scripts/patch-exe-icon.mjs 2>$null
Pop-Location

Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe)
