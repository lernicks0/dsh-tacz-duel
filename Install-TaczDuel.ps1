param([string]$SkillRoot, [string]$BotInstance)
$ErrorActionPreference = 'Stop'

if (-not $SkillRoot) {
    $dshConfigRoot = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path ([Environment]::GetFolderPath('UserProfile')) '.dsh' }
    $SkillRoot = Join-Path $dshConfigRoot 'skills'
}
$sourceDir = Join-Path $PSScriptRoot 'minecraft-tacz-duel'
if (-not (Test-Path -LiteralPath (Join-Path $sourceDir 'SKILL.md'))) { throw 'Extract this installer together with the minecraft-tacz-duel folder.' }
$destinationRoot = [IO.Path]::GetFullPath($SkillRoot)
$destinationDir = Join-Path $destinationRoot 'minecraft-tacz-duel'
if (Test-Path -LiteralPath $destinationDir) { throw "Skill already exists: $destinationDir. Review it before replacing." }
$bridge = Join-Path $sourceDir 'assets\dsh-tacz-bridge-1.20.1-0.1.0.jar'
if ($BotInstance) {
    if (-not (Test-Path -LiteralPath $BotInstance -PathType Container)) { throw 'BotInstance must be an existing independent Minecraft game instance directory.' }
    if (-not (Test-Path -LiteralPath $bridge)) { throw 'Bundled bridge JAR is missing.' }
    $modsDir = Join-Path (Resolve-Path -LiteralPath $BotInstance).Path 'mods'
    $bridgeDestination = Join-Path $modsDir 'dsh-tacz-bridge-1.20.1-0.1.0.jar'
    if (Test-Path -LiteralPath $bridgeDestination) { throw 'Bridge already exists in the bot instance; review it before replacing.' }
}
New-Item -ItemType Directory -Path $destinationRoot -Force | Out-Null
Copy-Item -LiteralPath $sourceDir -Destination $destinationDir -Recurse
Write-Output "Installed dsh skill: $destinationDir"
if ($BotInstance) {
    New-Item -ItemType Directory -Path $modsDir -Force | Out-Null
    Copy-Item -LiteralPath $bridge -Destination $bridgeDestination
    Write-Output "Installed bot client bridge: $bridgeDestination"
}
Write-Output 'Use an independent Forge 1.20.1 bot client with TACZ 1.1.8-hotfix and a different player account/nickname.'
Write-Output 'In dsh, invoke /minecraft-tacz-duel and provide your opponent nickname and the bot game instance path.'
