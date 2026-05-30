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
    'src/data.js'
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

function Read-JsonFile {
    param([string]$Path)
    return Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json
}

function Write-JsonFile {
    param(
        [string]$Path,
        [object]$Json
    )

    $text = $Json | ConvertTo-Json -Depth 100
    [System.IO.File]::WriteAllText((Resolve-Path -LiteralPath $Path), "$text`r`n", [System.Text.UTF8Encoding]::new($false))
}

function Get-AppVersion {
    return (Read-JsonFile 'package.json').version
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
        $json = Read-JsonFile 'package.json'
        $json.version = $Version
        Write-JsonFile 'package.json' $json
    }

    if (Test-Path -LiteralPath 'package-lock.json') {
        $json = Read-JsonFile 'package-lock.json'
        $json.version = $Version
        if ($json.packages -and $json.packages.PSObject.Properties['']) {
            $json.packages.PSObject.Properties[''].Value.version = $Version
        }
        Write-JsonFile 'package-lock.json' $json
    }

    foreach ($path in @('src-tauri/tauri.conf.json', 'src-tauri/tauri.conf.json5')) {
        if (Test-Path -LiteralPath $path) {
            $json = Read-JsonFile $path
            $json.version = $Version
            if ($json.plugins -and $json.plugins.updater) {
                $json.plugins.updater.endpoints = @($updaterEndpoint)
            }
            Write-JsonFile $path $json
        }
    }

    if (Test-Path -LiteralPath 'src-tauri/Cargo.toml') {
        $text = Get-Content -Raw -LiteralPath 'src-tauri/Cargo.toml'
        $text = [regex]::Replace($text, '(?m)^version\s*=\s*"[^"]+"', "version = `"$Version`"", 1)
        [System.IO.File]::WriteAllText((Resolve-Path -LiteralPath 'src-tauri/Cargo.toml'), $text, [System.Text.UTF8Encoding]::new($false))
    }

    if (Test-Path -LiteralPath 'src-tauri/Cargo.lock') {
        $text = Get-Content -Raw -LiteralPath 'src-tauri/Cargo.lock'
        $pattern = '(?ms)(\[\[package\]\]\s+name = "buildbook"\s+version = ")[^"]+(")'
        $text = [regex]::Replace($text, $pattern, { param($m) $m.Groups[1].Value + $Version + $m.Groups[2].Value }, 1)
        [System.IO.File]::WriteAllText((Resolve-Path -LiteralPath 'src-tauri/Cargo.lock'), $text, [System.Text.UTF8Encoding]::new($false))
    }

    if (Test-Path -LiteralPath 'src/data.js') {
        $text = Get-Content -Raw -LiteralPath 'src/data.js'
        $text = [regex]::Replace($text, "export const APP_VERSION = '[^']+';", "export const APP_VERSION = '$Version';", 1)
        [System.IO.File]::WriteAllText((Resolve-Path -LiteralPath 'src/data.js'), $text, [System.Text.UTF8Encoding]::new($false))
    }

    Write-Host "Version set to $Version"
}

function Increment-TestVersion {
    param([string]$Version)

    if ($Version -match '^(\d+)\.(\d+)\.(\d+)-test\.(\d+)$') {
        $test = [int]$matches[4] + 1
        return "$($matches[1]).$($matches[2]).$($matches[3])-test.$($test.ToString('00'))"
    }

    if ($Version -match '^(\d+)\.(\d+)\.(\d+)$') {
        $build = [int]$matches[3] + 1
        return "$($matches[1]).$($matches[2]).$build-test.00"
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

function Commit-Version {
    param(
        [string]$Version,
        [string]$Message
    )

    Set-AppVersion $Version
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

    Commit-Version $newVersion "Test Release $newVersion"
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

    Invoke-Git merge $TestBranch
    Commit-Version $newLiveVersion "Live Release $newLiveVersion"
    Invoke-Git push origin $MainBranch
    Invoke-Git tag $liveTag
    Invoke-Git push origin $liveTag

    Invoke-Git checkout $TestBranch
    Invoke-Git merge $MainBranch

    $nextTestBuild = Increment-LiveVersion $newLiveVersion
    $newTestVersion = "$nextTestBuild-test.00"
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
