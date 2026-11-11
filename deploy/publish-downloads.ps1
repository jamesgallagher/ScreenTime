# Publishes the parent app and the PC installer for the download page at /app (docs/SPEC.md §12.5).
# The kid app is published with android\publish-kid.ps1, which also feeds that page. From the repo root, with pwsh:
#   pwsh -File deploy\publish-downloads.ps1 -Parent             the parent app: raise versionCode and versionName in
#                                                              android\app-parent\build.gradle.kts first
#   pwsh -File deploy\publish-downloads.ps1 -Windows            the newest ScreenTime.msi that CI built on main
#   pwsh -File deploy\publish-downloads.ps1 -Parent -Windows    both
#   ... -To deploy\releases                                    a folder instead: the development server's
# The file goes first and its .json last, so the page never offers a file that is not there yet.
param(
    [switch]$Parent,
    [switch]$Windows,
    [string]$To,
    [string]$Ssh = 'root@192.168.0.148',
    [string]$SshDir = '/mnt/user/appdata/screentime/releases',
    [string]$Repo = 'jamesgallagher/ScreenTime'
)
$ErrorActionPreference = 'Stop'
if (-not $Parent -and -not $Windows) { throw 'Say what to publish: -Parent, -Windows or both.' }
$root = Split-Path $PSScriptRoot
$work = Join-Path (Split-Path $root) 'temp\publish-downloads'
New-Item -ItemType Directory -Force $work | Out-Null

function Send-File([string]$path, [string]$file, [string]$jsonName, [hashtable]$release) {
    $json = Join-Path $work $jsonName
    [IO.File]::WriteAllText($json, ($release | ConvertTo-Json -Compress))
    if ($To) {
        New-Item -ItemType Directory -Force $To | Out-Null
        Copy-Item $path (Join-Path $To $file) -Force
        Copy-Item $json (Join-Path $To $jsonName) -Force
    } else {
        & ssh $Ssh "mkdir -p '$SshDir'"
        if ($LASTEXITCODE -ne 0) { throw 'Cannot reach the server over SSH.' }
        & scp -q $path "${Ssh}:$SshDir/$file"
        if ($LASTEXITCODE -ne 0) { throw "Copying $file failed." }
        & scp -q $json "${Ssh}:$SshDir/$jsonName.new"
        & ssh $Ssh "mv '$SshDir/$jsonName.new' '$SshDir/$jsonName'"
    }
    Write-Output "Published $($release.versionName): $file, $($release.sizeBytes) bytes"
}

function Describe([string]$path, [string]$file, [string]$versionName, $versionCode) {
    $release = [ordered]@{
        versionName = $versionName
        sha256      = (Get-FileHash $path -Algorithm SHA256).Hash.ToLowerInvariant()
        sizeBytes   = (Get-Item $path).Length
        file        = $file
    }
    if ($versionCode) { $release.versionCode = [int]$versionCode }
    return $release
}

if ($Parent) {
    $gradle = Get-Content "$root\android\app-parent\build.gradle.kts" -Raw
    $code = [regex]::Match($gradle, 'versionCode\s*=\s*(\d+)').Groups[1].Value
    $name = [regex]::Match($gradle, 'versionName\s*=\s*"([^"]+)"').Groups[1].Value
    if (-not $code -or -not $name) { throw 'No versionCode or versionName in android\app-parent\build.gradle.kts.' }
    if (-not (Test-Path "$root\android\keystore.properties")) { throw 'No android\keystore.properties: a release build would not be signed.' }
    if (-not (Test-Path "$root\android\app-parent\google-services.json")) { throw 'No android\app-parent\google-services.json: the app would get no push messages.' }
    Push-Location "$root\android"
    try { .\gradlew.bat :app-parent:assembleRelease --quiet } finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) { throw 'The parent app did not build.' }
    $apk = "$root\android\app-parent\build\outputs\apk\release\app-parent-release.apk"
    $file = "parent-$code.apk"
    Send-File $apk $file 'parent.json' (Describe $apk $file $name $code)
}

if ($Windows) {
    $run = gh run list --repo $Repo --workflow windows.yml --branch main --status success --limit 1 --json databaseId,number --jq '.[0] | "\(.databaseId) \(.number)"'
    if (-not $run) { throw 'No successful Windows build on main. Start one: gh workflow run windows.yml --repo jamesgallagher/ScreenTime --ref main' }
    $id, $number = $run -split ' '
    $dir = Join-Path $work "msi-$number"
    Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
    gh run download $id --repo $Repo --name ScreenTime-msi --dir $dir
    if ($LASTEXITCODE -ne 0) { throw "The MSI of run $number has expired (GitHub keeps it 14 days). Start a new build: gh workflow run windows.yml --repo jamesgallagher/ScreenTime --ref main" }
    # CI builds it as version 0.1.<run number> (.github/workflows/windows.yml).
    $version = "0.1.$number"
    $file = "ScreenTime-$version.msi"
    Send-File (Join-Path $dir 'ScreenTime.msi') $file 'windows.json' (Describe (Join-Path $dir 'ScreenTime.msi') $file $version $null)
}
