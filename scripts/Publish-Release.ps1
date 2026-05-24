[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot

function Stop-Release([string] $message) {
    Write-Host ''
    Write-Host "Release stopped: $message" -ForegroundColor Red
    exit 1
}

try {
    $packageVersion = (Get-Content -Raw -LiteralPath 'package.json' | ConvertFrom-Json).version
    $tauriVersion = (Get-Content -Raw -LiteralPath 'src-tauri\tauri.conf.json' | ConvertFrom-Json).version
    $cargoText = Get-Content -Raw -LiteralPath 'src-tauri\Cargo.toml'
    $cargoVersion = [regex]::Match($cargoText, '(?m)^version = "([^"]+)"').Groups[1].Value
    $dataText = Get-Content -Raw -LiteralPath 'src\data.js'
    $appVersion = [regex]::Match($dataText, "APP_VERSION = '([^']+)'").Groups[1].Value
} catch {
    Stop-Release "Could not read the BuildBook version files. $($_.Exception.Message)"
}

$versions = @($packageVersion, $tauriVersion, $cargoVersion, $appVersion) | Select-Object -Unique
if ($versions.Count -ne 1 -or [string]::IsNullOrWhiteSpace($packageVersion)) {
    Stop-Release 'Version files do not match. Update the app version before publishing.'
}

git rev-parse --is-inside-work-tree *> $null
if ($LASTEXITCODE -ne 0) {
    Stop-Release 'This launcher must be run from the BuildBook Git repository.'
}

$changes = git status --porcelain --untracked-files=all
if ($LASTEXITCODE -ne 0) {
    Stop-Release 'Could not read Git status.'
}
if ($changes) {
    Stop-Release 'Commit and push all changes before creating a release.'
}

$branch = (git branch --show-current).Trim()
if ($branch -ne 'main') {
    Stop-Release "Switch to the main branch before publishing. Current branch: $branch"
}

Write-Host 'Checking GitHub branch state...'
git fetch origin main --quiet
if ($LASTEXITCODE -ne 0) {
    Stop-Release 'Could not fetch origin/main. Check the network connection and repository access.'
}

$comparison = ((git rev-list --left-right --count 'origin/main...HEAD').Trim() -split '\s+')
if ($LASTEXITCODE -ne 0 -or $comparison.Count -ne 2) {
    Stop-Release 'Could not compare local main to origin/main.'
}
if ([int] $comparison[0] -gt 0) {
    Stop-Release 'Local main is behind GitHub. Pull the latest changes before publishing.'
}
if ([int] $comparison[1] -gt 0) {
    Stop-Release 'Local main has commits not on GitHub. Push them before publishing.'
}

$tag = "v$packageVersion"
if (git tag --list $tag) {
    Stop-Release "Tag $tag already exists locally."
}

git ls-remote --exit-code --tags origin "refs/tags/$tag" *> $null
if ($LASTEXITCODE -eq 0) {
    Stop-Release "Tag $tag already exists on GitHub."
}
if ($LASTEXITCODE -ne 2) {
    Stop-Release 'Could not check existing GitHub release tags.'
}

Write-Host ''
Write-Host "Ready to publish BuildBook $tag." -ForegroundColor Cyan
$confirmation = Read-Host 'Type RELEASE to create and push this release tag'
if ($confirmation -cne 'RELEASE') {
    Stop-Release 'Confirmation was not entered.'
}

git tag -a $tag -m "BuildBook $tag"
if ($LASTEXITCODE -ne 0) {
    Stop-Release "Could not create tag $tag."
}

git push origin $tag
if ($LASTEXITCODE -ne 0) {
    Stop-Release "Could not push $tag. The local tag was created; resolve the issue and push it manually."
}

Write-Host ''
Write-Host "Published tag $tag. GitHub Actions is preparing the installer release." -ForegroundColor Green
