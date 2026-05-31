$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$MainBranch = 'main'
$TestBranch = 'test'
$LiveUpdaterEndpoint = 'https://github.com/illerin/BuildBook/releases/latest/download/latest.json'
$TestUpdaterEndpoint = 'https://github.com/illerin/BuildBook/releases/download/test-latest/latest.json'

$VersionFiles = @(
    'package.json',
    'package-lock.json',
    'src-tauri/tauri.conf.json',
    'src-tauri/tauri.conf.json5',
    'src-tauri/Cargo.toml',
    'src-tauri/Cargo.lock',
    'src/data.js',
    'CHANGELOG.md',
    'RELEASE_NOTES.md'
) | Where-Object { Test-Path -LiteralPath $_ }

function Invoke-Git {
    param(
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]]$Arguments
    )

    Write-Host "git $($Arguments -join ' ')"
    & git @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Git command failed: git $($Arguments -join ' ')"
    }
}

function Get-GitText {
    param(
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]]$Arguments
    )

    $output = & git @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Git command failed: git $($Arguments -join ' ')`n$output"
    }
    return ($output -join "`n").Trim()
}

function Assert-CleanRepo {
    $status = Get-GitText status --porcelain
    if (-not [string]::IsNullOrWhiteSpace($status)) {
        throw "Repo is not clean. Commit or stash changes before publishing."
    }
}

function Assert-TagAvailable {
    param([string]$Tag)

    & git rev-parse -q --verify "refs/tags/$Tag" *> $null
    if ($LASTEXITCODE -eq 0) {
        throw "Local tag already exists: $Tag"
    }

    $remoteTag = Get-GitText ls-remote --tags origin "refs/tags/$Tag"
    if (-not [string]::IsNullOrWhiteSpace($remoteTag)) {
        throw "Remote tag already exists: $Tag"
    }
}

function Write-TextFile {
    param(
        [string]$Path,
        [string]$Text
    )

    $fullPath = if (Test-Path -LiteralPath $Path) {
        (Resolve-Path -LiteralPath $Path).Path
    } else {
        Join-Path (Get-Location) $Path
    }
    [System.IO.File]::WriteAllText($fullPath, $Text, [System.Text.UTF8Encoding]::new($false))
}

function Get-AppVersion {
    $text = Get-Content -Raw -LiteralPath 'package.json'
    $match = [regex]::Match($text, '(?m)^\s*"version"\s*:\s*"([^"]+)"')
    if (-not $match.Success) {
        throw 'Could not read version from package.json.'
    }
    return $match.Groups[1].Value
}

function Get-VersionChannel {
    param([string]$Version)

    if ($Version -match '-test(?:\.|$)') {
        return 'test'
    }
    return 'live'
}

function Set-AppVersion {
    param([string]$Version)

    $channel = Get-VersionChannel $Version
    $updaterEndpoint = if ($channel -eq 'test') { $TestUpdaterEndpoint } else { $LiveUpdaterEndpoint }

    if (Test-Path -LiteralPath 'package.json') {
        $text = Get-Content -Raw -LiteralPath 'package.json'
        $text = [regex]::Replace($text, '(?m)^(\s*"version"\s*:\s*")[^"]+(")', "`${1}$Version`${2}", 1)
        Write-TextFile 'package.json' $text
    }

    if (Test-Path -LiteralPath 'package-lock.json') {
        $text = Get-Content -Raw -LiteralPath 'package-lock.json'
        $regex = [regex]'(?m)^(\s*"version"\s*:\s*")[^"]+(")'
        $text = $regex.Replace($text, { param($m) $m.Groups[1].Value + $Version + $m.Groups[2].Value }, 2)
        Write-TextFile 'package-lock.json' $text
    }

    foreach ($path in @('src-tauri/tauri.conf.json', 'src-tauri/tauri.conf.json5')) {
        if (Test-Path -LiteralPath $path) {
            $text = Get-Content -Raw -LiteralPath $path
            $text = [regex]::Replace($text, '(?m)^(\s*"version"\s*:\s*")[^"]+(")', "`${1}$Version`${2}", 1)
            $text = [regex]::Replace($text, '(?s)("endpoints"\s*:\s*\[\s*")[^"]+(")', "`${1}$updaterEndpoint`${2}", 1)
            Write-TextFile $path $text
        }
    }

    if (Test-Path -LiteralPath 'src-tauri/Cargo.toml') {
        $text = Get-Content -Raw -LiteralPath 'src-tauri/Cargo.toml'
        $text = [regex]::Replace($text, '(?m)^version\s*=\s*"[^"]+"', "version = `"$Version`"", 1)
        Write-TextFile 'src-tauri/Cargo.toml' $text
    }

    if (Test-Path -LiteralPath 'src-tauri/Cargo.lock') {
        $text = Get-Content -Raw -LiteralPath 'src-tauri/Cargo.lock'
        $pattern = '(?ms)(\[\[package\]\]\s+name = "buildbook"\s+version = ")[^"]+(")'
        $text = [regex]::Replace($text, $pattern, { param($m) $m.Groups[1].Value + $Version + $m.Groups[2].Value }, 1)
        Write-TextFile 'src-tauri/Cargo.lock' $text
    }

    if (Test-Path -LiteralPath 'src/data.js') {
        $text = Get-Content -Raw -LiteralPath 'src/data.js'
        $text = [regex]::Replace($text, "export const APP_VERSION = '[^']+';", "export const APP_VERSION = '$Version';", 1)
        Write-TextFile 'src/data.js' $text
    }

    Write-Host "Version set to $Version"
}

function Increment-TestVersion {
    param([string]$Version)

    if ($Version -match '^(\d+)\.(\d+)\.(\d+)-test\.(\d+)$') {
        $test = [int]$matches[4] + 1
        return "$($matches[1]).$($matches[2]).$($matches[3])-test.$test"
    }

    if ($Version -match '^(\d+)\.(\d+)\.(\d+)$') {
        $build = [int]$matches[3] + 1
        return "$($matches[1]).$($matches[2]).$build-test.0"
    }

    throw "Invalid test version format: $Version"
}

function Increment-LiveVersion {
    param([string]$Version)

    if ($Version -match '^(\d+)\.(\d+)\.(\d+)(?:-test\.\d+)?$') {
        $build = [int]$matches[3] + 1
        return "$($matches[1]).$($matches[2]).$build"
    }

    throw "Invalid live version format: $Version"
}

function Get-PreviousTag {
    param([string]$Pattern)

    $output = & git describe --tags --match $Pattern --abbrev=0 2>$null
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace(($output -join '').Trim())) {
        return ''
    }
    return (($output | Select-Object -First 1) -as [string]).Trim()
}

function Get-ReleaseChangeLines {
    param([string]$PreviousTag)

    $args = @('log', '--no-merges', '--pretty=format:%s')
    if (-not [string]::IsNullOrWhiteSpace($PreviousTag)) {
        $args += "$PreviousTag..HEAD"
    }
    $raw = Get-GitText @args
    if ([string]::IsNullOrWhiteSpace($raw)) {
        return @('- No code changes since the previous release.')
    }
    $lines = $raw -split "`n" |
        ForEach-Object { $_.Trim() } |
        Where-Object {
            $_ -and
            $_ -notmatch '^(Test Release|Live Release|Reset test version)\b'
        } |
        Select-Object -Unique

    if (!$lines.Count) {
        return @('- No code changes since the previous release.')
    }
    return $lines | ForEach-Object { "- $_" }
}

function Write-ReleaseNotes {
    param(
        [string]$Version,
        [string]$Channel,
        [string]$PreviousTag
    )

    $date = Get-Date -Format 'yyyy-MM-dd'
    $heading = if ($Channel -eq 'test') { "BuildBook $Version Test Release" } else { "BuildBook $Version" }
    $range = if ($PreviousTag) { "Changes since $PreviousTag." } else { 'Initial tracked release notes.' }
    $lines = Get-ReleaseChangeLines $PreviousTag
    $notes = @(
        "# $heading",
        '',
        $range,
        '',
        '## Changes',
        ''
    ) + $lines + @('')

    Write-TextFile 'RELEASE_NOTES.md' (($notes -join "`r`n") + "`r`n")

    $changelogHeader = "# Changelog`r`n`r`n"
    $section = @(
        "## $Version - $date",
        '',
        $range,
        '',
        '### Changes',
        ''
    ) + $lines + @('', '')
    $existing = if (Test-Path -LiteralPath 'CHANGELOG.md') { Get-Content -Raw -LiteralPath 'CHANGELOG.md' } else { $changelogHeader }
    $body = $existing
    if ($body -notmatch '^# Changelog') {
        $body = $changelogHeader + $body.TrimStart()
    }
    $body = $body -replace '^# Changelog\s*', "# Changelog`r`n`r`n"
    Write-TextFile 'CHANGELOG.md' ("# Changelog`r`n`r`n" + (($section -join "`r`n") + ($body -replace '^# Changelog\s*', '')).TrimStart())
}

function Commit-Version {
    param(
        [string]$Version,
        [string]$Message,
        [string]$Channel = 'live',
        [string]$PreviousTag = ''
    )

    Set-AppVersion $Version
    Write-ReleaseNotes $Version $Channel $PreviousTag
    $script:VersionFiles = @(
        'package.json',
        'package-lock.json',
        'src-tauri/tauri.conf.json',
        'src-tauri/tauri.conf.json5',
        'src-tauri/Cargo.toml',
        'src-tauri/Cargo.lock',
        'src/data.js',
        'CHANGELOG.md',
        'RELEASE_NOTES.md'
    ) | Where-Object { Test-Path -LiteralPath $_ }
    Invoke-Git add -- @VersionFiles

    & git diff --cached --quiet -- @VersionFiles
    if ($LASTEXITCODE -eq 0) {
        throw "No version file changes were staged."
    }

    Invoke-Git commit -m $Message
}

function Publish-Test {
    Assert-CleanRepo

    Invoke-Git checkout $TestBranch
    Invoke-Git pull --ff-only origin $TestBranch
    Assert-CleanRepo

    $newVersion = Increment-TestVersion (Get-AppVersion)
    $tag = "test-v$newVersion"
    Assert-TagAvailable $tag
    $previousTag = Get-PreviousTag 'test-v*'

    Commit-Version $newVersion "Test Release $newVersion" 'test' $previousTag
    Invoke-Git push origin $TestBranch
    Invoke-Git tag $tag
    Invoke-Git push origin $tag

    Write-Host ""
    Write-Host "TEST release published."
    Write-Host "Version: $newVersion"
    Write-Host "Tag: $tag"
}

function Publish-Live {
    Assert-CleanRepo

    Invoke-Git checkout $TestBranch
    Invoke-Git pull --ff-only origin $TestBranch
    Assert-CleanRepo

    Invoke-Git checkout $MainBranch
    Invoke-Git pull --ff-only origin $MainBranch
    Assert-CleanRepo

    $mainVersion = Get-AppVersion
    $newLiveVersion = Increment-LiveVersion $mainVersion
    $liveTag = "v$newLiveVersion"
    Assert-TagAvailable $liveTag
    $previousLiveTag = Get-PreviousTag 'v[0-9]*'

    Invoke-Git merge $TestBranch
    Commit-Version $newLiveVersion "Live Release $newLiveVersion" 'live' $previousLiveTag
    Invoke-Git push origin $MainBranch
    Invoke-Git tag $liveTag
    Invoke-Git push origin $liveTag

    Invoke-Git checkout $TestBranch
    Invoke-Git merge $MainBranch

    $nextTestBuild = Increment-LiveVersion $newLiveVersion
    $newTestVersion = "$nextTestBuild-test.0"
    Set-AppVersion $newTestVersion
    Invoke-Git add -- @VersionFiles

    & git diff --cached --quiet -- @VersionFiles
    if ($LASTEXITCODE -ne 0) {
        Invoke-Git commit -m "Reset test version $newTestVersion"
        Invoke-Git push origin $TestBranch
    } else {
        Write-Host "Test branch already has version $newTestVersion"
    }

    Write-Host ""
    Write-Host "LIVE release published."
    Write-Host "Live Version: $newLiveVersion"
    Write-Host "Live Tag: $liveTag"
    Write-Host "Test Reset To: $newTestVersion"
}

Write-Host ""
Write-Host "==========================="
Write-Host " BuildBook Publish Menu"
Write-Host "==========================="
Write-Host ""
Write-Host "1. Publish TEST"
Write-Host "2. Publish LIVE"
Write-Host ""

$choice = Read-Host "Select option"

switch ($choice) {
    '1' { Publish-Test }
    '2' { Publish-Live }
    default { throw 'Invalid selection.' }
}
