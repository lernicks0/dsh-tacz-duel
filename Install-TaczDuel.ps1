param([string]$SkillRoot, [string]$BotInstance, [switch]$Update)
$ErrorActionPreference = 'Stop'
if (-not $SkillRoot) {
    $dshConfigRoot = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path ([Environment]::GetFolderPath('UserProfile')) '.dsh' }
    $SkillRoot = Join-Path $dshConfigRoot 'skills'
}
$sourceDir = Join-Path $PSScriptRoot 'minecraft-tacz-duel'
$destinationRoot = [IO.Path]::GetFullPath($SkillRoot)
$destinationDir = Join-Path $destinationRoot 'minecraft-tacz-duel'
if (-not (Test-Path -LiteralPath (Join-Path $sourceDir 'SKILL.md'))) { throw 'Extract the installer together with minecraft-tacz-duel.' }
if ([IO.Path]::GetFullPath($sourceDir).Equals($destinationDir, [StringComparison]::OrdinalIgnoreCase)) { throw 'Source and installation directory must differ.' }
if ((Test-Path -LiteralPath $destinationDir) -and -not $Update) { throw "Skill exists: $destinationDir. Use -Update to back up and upgrade." }
$bridge = Join-Path $sourceDir 'assets\dsh-tacz-bridge-1.20.1-0.1.1.jar'
$oldBridges = @()
if ($BotInstance) {
    if (-not (Test-Path -LiteralPath $BotInstance -PathType Container)) { throw 'BotInstance must be an existing game instance directory.' }
    if (-not (Test-Path -LiteralPath $bridge)) { throw 'Bundled bridge JAR is missing.' }
    $instancePath = (Resolve-Path -LiteralPath $BotInstance).Path
    # Replacing an in-use JAR does not update running game code. Do not terminate games.
    $runningClients = @(Get-CimInstance Win32_Process -Filter "Name='java.exe' OR Name='javaw.exe'" | Where-Object {
        $_.CommandLine -and ($_.CommandLine.Replace('/', '\').IndexOf($instancePath, [StringComparison]::OrdinalIgnoreCase) -ge 0)
    })
    if ($runningClients.Count -gt 0) { throw 'Save and close ALL Minecraft clients using BotInstance, then run the installer again. No game process was stopped.' }
    $modsDir = Join-Path $instancePath 'mods'
    if (Test-Path -LiteralPath $modsDir) { $oldBridges = @(Get-ChildItem -LiteralPath $modsDir -File -Filter 'dsh-tacz-bridge-*.jar') }
    if ($oldBridges.Count -gt 0 -and -not $Update) { throw 'An existing bridge was found. Use -Update after closing the clients.' }
    $bridgeDestination = Join-Path $modsDir 'dsh-tacz-bridge-1.20.1-0.1.1.jar'
}
$stamp = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
if (Test-Path -LiteralPath $destinationDir) {
    $skillBackup = Join-Path $destinationRoot ".backups\minecraft-tacz-duel-$stamp"
    New-Item -ItemType Directory -Path $skillBackup -Force | Out-Null
    Get-ChildItem -LiteralPath $destinationDir -Force | Where-Object { $_.Name -ne '.runtime' } | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $skillBackup -Recurse
    }
    Write-Output "Skill backup: $skillBackup"
}
New-Item -ItemType Directory -Path $destinationDir -Force | Out-Null
foreach ($entry in @('SKILL.md', 'LICENSE', '.gitignore', 'scripts', 'references')) {
    Copy-Item -LiteralPath (Join-Path $sourceDir $entry) -Destination $destinationDir -Recurse -Force
}
$assetDestination = Join-Path $destinationDir 'assets'
New-Item -ItemType Directory -Path $assetDestination -Force | Out-Null
# The bridge is our own artifact. Backups have already been taken outside this directory.
Get-ChildItem -LiteralPath $assetDestination -File -Filter 'dsh-tacz-bridge-*.jar' | ForEach-Object { Remove-Item -LiteralPath $_.FullName }
Copy-Item -LiteralPath $bridge -Destination $assetDestination
Copy-Item -LiteralPath (Join-Path $sourceDir 'assets\build-info.json') -Destination $assetDestination -Force
$forgeDestination = Join-Path $destinationDir 'forge'
New-Item -ItemType Directory -Path $forgeDestination -Force | Out-Null
foreach ($entry in @('build.gradle', 'settings.gradle', 'gradle.properties', 'src')) {
    Copy-Item -LiteralPath (Join-Path $sourceDir "forge\$entry") -Destination $forgeDestination -Recurse -Force
}
Write-Output "Installed skill 0.1.1: $destinationDir (existing .runtime retained)"
if ($BotInstance) {
    $bridgeBackup = Join-Path $instancePath "config\dsh-tacz-bridge\backups\$stamp"
    if ($oldBridges.Count -gt 0) {
        New-Item -ItemType Directory -Path $bridgeBackup -Force | Out-Null
        foreach ($old in $oldBridges) { Copy-Item -LiteralPath $old.FullName -Destination $bridgeBackup }
    }
    New-Item -ItemType Directory -Path $modsDir -Force | Out-Null
    # Stage and verify the new file before removing the prior version.
    $stagedBridge = Join-Path $modsDir 'dsh-tacz-bridge-1.20.1-0.1.1.jar.pending'
    Copy-Item -LiteralPath $bridge -Destination $stagedBridge -Force
    if ((Get-FileHash -LiteralPath $bridge).Hash -ne (Get-FileHash -LiteralPath $stagedBridge).Hash) { throw 'Bridge copy verification failed; old bridge retained.' }
    foreach ($old in $oldBridges) { Remove-Item -LiteralPath $old.FullName }
    Move-Item -LiteralPath $stagedBridge -Destination $bridgeDestination
    Write-Output "Installed bridge: $bridgeDestination"
    if ($oldBridges.Count -gt 0) { Write-Output "Old bridge backup outside mods: $bridgeBackup" }
}
Write-Output 'Reload this skill in DSH. Start Minecraft, connect using --instance and --bot, then learn, prepare, check and duel-start.'
