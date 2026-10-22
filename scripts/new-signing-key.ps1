#Requires -Version 5.1
<#
    new-signing-key.ps1  —  release signing key rotation for com.almohanndes.app

    Creates a NEW keystore (RSA 4096, ~30 years) and rewrites
    android/keystore.properties so the next `gradlew assembleRelease` is signed
    with it. Both files are git-ignored, so nothing lands in version control.

    Why: the previous keystore + its password were committed to Git history and
    must be considered public. A key that leaked cannot be "un-leaked"; the only
    fix is a new key (see docs/ROTATION-RUNBOOK.md).

    Usage (from the repo root):
        npm run key:new
        powershell -ExecutionPolicy Bypass -File scripts/new-signing-key.ps1 -Force

    The password is never echoed and never written anywhere except
    android/keystore.properties (which must stay out of Git).
#>
[CmdletBinding()]
param(
    [string] $KeyStoreName = 'almohanndes-2026.keystore',
    [string] $Alias = 'almohanndes',
    [string] $DistinguishedName = 'CN=Almohanndes, OU=Mobile, O=Almohanndes, L=Sanaa, C=YE',
    [switch] $Force
)

$ErrorActionPreference = 'Stop'

function Resolve-KeyTool {
    $candidates = @()
    if ($env:JAVA_HOME) { $candidates += (Join-Path $env:JAVA_HOME 'bin\keytool.exe') }
    $candidates += 'C:\Program Files\Java\jdk-17\bin\keytool.exe'
    $candidates += 'C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe'
    foreach ($c in $candidates) {
        if ($c -and (Test-Path -LiteralPath $c)) { return $c }
    }
    throw 'keytool.exe not found. Install a JDK (17+) or set JAVA_HOME.'
}

function Read-NewPassword {
    param([string] $Prompt, [string] $Previous)
    while ($true) {
        $first = Read-Host -Prompt $Prompt -AsSecureString
        $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
            [Runtime.InteropServices.Marshal]::SecureStringToBSTR($first))
        if (-not $plain -or $plain.Length -lt 12) {
            Write-Host '  -> too short: use at least 12 characters.' -ForegroundColor Yellow
            continue
        }
        if ($Previous -and ($Previous.Contains($plain) -or $plain.Contains($Previous))) {
            Write-Host '  -> this is derived from the OLD (leaked) password. Pick something unrelated.' -ForegroundColor Yellow
            continue
        }
        $second = Read-Host -Prompt "$Prompt (again)" -AsSecureString
        $again = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
            [Runtime.InteropServices.Marshal]::SecureStringToBSTR($second))
        if ($plain -ne $again) {
            Write-Host '  -> the two entries do not match, try again.' -ForegroundColor Yellow
            continue
        }
        return $plain
    }
}

$repoRoot   = Split-Path -Parent $PSScriptRoot
$androidDir = Join-Path $repoRoot 'android'
$keyStore   = Join-Path $androidDir $KeyStoreName
$propsPath  = Join-Path $androidDir 'keystore.properties'

if (-not (Test-Path -LiteralPath $androidDir)) {
    throw "Not a project root: $androidDir not found. Run this from the repository root."
}

# Guard: a tracked properties file means the password lands in Git history.
$trackedProps = git ls-files -- 'android/keystore.properties' 'android/keystore.properties.old' 2>$null
if ($trackedProps) {
    throw "keystore.properties is TRACKED in Git ($trackedProps). Run: git rm --cached android/keystore.properties && git commit"
}

# The previous password is only used to reject a new password derived from it.
$previousPassword = ''
if (Test-Path -LiteralPath $propsPath) {
    $previousPassword = (Get-Content -LiteralPath $propsPath | Where-Object { $_ -match '^storePassword=' }) -replace '^storePassword=', ''
}

Write-Host ''
Write-Host '=== New release signing key ===' -ForegroundColor Cyan
Write-Host "keystore : android\$KeyStoreName"
Write-Host "alias    : $Alias"
Write-Host ''

if (Test-Path -LiteralPath $keyStore) {
    if (-not $Force) {
        throw "android\$KeyStoreName already exists. Re-run with -Force to overwrite (this destroys the key!)."
    }
    Write-Host 'Overwriting the existing keystore (-Force).' -ForegroundColor Yellow
    Remove-Item -LiteralPath $keyStore -Force
}

$password = Read-NewPassword -Prompt 'New keystore password' -Previous $previousPassword
$keytool  = Resolve-KeyTool

Write-Host ''
Write-Host "Generating key with $keytool ..."
& $keytool -genkeypair -v `
    -keystore $keyStore `
    -alias $Alias `
    -keyalg RSA `
    -keysize 4096 `
    -validity 10950 `
    -dname $DistinguishedName `
    -storetype PKCS12 `
    -storepass $password `
    -keypass $password
if ($LASTEXITCODE -ne 0) { throw "keytool failed with exit code $LASTEXITCODE" }

# Keep the previous properties file around: it points at the leaked key and may
# still be needed to verify an older APK before it is retired.
# NOTE: .bak is git-ignored (keystore.properties.*). Never commit it.
if (Test-Path -LiteralPath $propsPath) {
    Copy-Item -LiteralPath $propsPath -Destination "$propsPath.bak" -Force
    Write-Host 'Old android/keystore.properties saved as keystore.properties.bak (git-ignored)' -ForegroundColor DarkGray
}

$properties = @(
    "storeFile=$KeyStoreName"
    "keyAlias=$Alias"
    "storePassword=$password"
    "keyPassword=$password"
)
Set-Content -LiteralPath $propsPath -Value $properties -Encoding ASCII

Write-Host ''
Write-Host 'Fingerprint (record it, e.g. in the bot release notes):' -ForegroundColor Cyan
& $keytool -list -v -keystore $keyStore -alias $Alias -storepass $password |
    Select-String -Pattern 'SHA256:|Valid from' |
    ForEach-Object { '  ' + $_.Line.Trim() }

Write-Host ''
Write-Host 'Done. Next steps:' -ForegroundColor Green
Write-Host '  1. Copy the .keystore to a password manager / offline backup OUTSIDE OneDrive.'
Write-Host '  2. Bump versionCode in android/app/build.gradle (currently 31).'
Write-Host '  3. cd android; .\gradlew.bat assembleRelease'
Write-Host '  4. Tell the three current users to UNINSTALL the old app, then install the new APK'
Write-Host '     (Android refuses an update when the signature changed).'
Write-Host '  5. Only after everyone is on the new build: apply 20261023011000_lock_pii_reads.sql'
