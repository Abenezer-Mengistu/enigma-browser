$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$exeCandidates = @(
    (Join-Path $root 'dist\win-unpacked\Enigma.exe'),
    (Join-Path $root 'dist2\win-unpacked\Enigma.exe'),
    (Join-Path $root 'dist\win-unpacked\Enigma Browser.exe'),
    (Join-Path $root 'dist2\win-unpacked\Enigma Browser.exe')
)
$exe = $exeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
$icon = Join-Path $root 'assets\icons\icon.ico'

if (-not (Test-Path $exe)) {
    Write-Host ''
    Write-Host '  Building Enigma first...' -ForegroundColor Yellow
    Push-Location $root
    npm run build:dir
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Pop-Location
    $exe = $exeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}

if (-not (Test-Path $exe)) {
    Write-Host '  Build failed — could not find Enigma.exe' -ForegroundColor Red
    exit 1
}

$desktop = [Environment]::GetFolderPath('Desktop')
$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$targets = @(
    (Join-Path $desktop 'Enigma.lnk'),
    (Join-Path $startMenu 'Enigma.lnk')
)
$legacy = @(
    (Join-Path $desktop 'Enigma Browser.lnk'),
    (Join-Path $startMenu 'Enigma Browser.lnk')
)

foreach ($old in $legacy) {
    if (Test-Path $old) { Remove-Item $old -Force }
}

foreach ($lnk in $targets) {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($lnk)
    $shortcut.TargetPath = $exe
    $shortcut.WorkingDirectory = Split-Path $exe
    if (Test-Path $icon) {
        $shortcut.IconLocation = "$icon,0"
    } else {
        $shortcut.IconLocation = "$exe,0"
    }
    $shortcut.Description = 'Enigma'
    $shortcut.Save()
    Write-Host "  Shortcut: $lnk" -ForegroundColor Green
}

Write-Host ''
Write-Host '  Use the Desktop shortcut — NOT npm start' -ForegroundColor Cyan
Write-Host ''
