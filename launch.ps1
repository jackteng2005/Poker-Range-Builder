# Starts the Range Vault server (if not already up), opens it as a standalone
# app window, waits for that window to close, then stops the server.

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverPath = Join-Path $root 'server.js'

function ServerUp {
  try {
    Invoke-WebRequest -Uri 'http://localhost:5173/' -UseBasicParsing -TimeoutSec 1 | Out-Null
    return $true
  } catch {
    return $false
  }
}

if (-not (ServerUp)) {
  Start-Process -FilePath 'node.exe' -ArgumentList "`"$serverPath`"" -WindowStyle Hidden
  Start-Sleep -Milliseconds 900
}

$profileDir = Join-Path $env:TEMP 'range-vault-app-profile'
$chrome = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
$edge = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
$browser = if (Test-Path $chrome) { $chrome } elseif (Test-Path $edge) { $edge } else { $null }

if ($browser) {
  $browserProcName = [System.IO.Path]::GetFileNameWithoutExtension($browser)
  $args = @(
    '--app=http://localhost:5173',
    '--window-size=1400,900',
    "--user-data-dir=$profileDir",
    '--no-first-run',
    '--no-default-browser-check'
  )
  Start-Process -FilePath $browser -ArgumentList $args | Out-Null

  # Chrome/Edge can hand off to a re-spawned process on launch, so rather than
  # tracking one fragile PID, poll for any process still using this app's
  # dedicated profile dir and wait until none remain.
  Start-Sleep -Seconds 2
  do {
    Start-Sleep -Seconds 1
    $stillOpen = Get-CimInstance Win32_Process -Filter "Name='$browserProcName.exe'" |
      Where-Object { $_.CommandLine -like "*$profileDir*" }
  } while ($stillOpen)
} else {
  Start-Process 'http://localhost:5173'
}

# App window closed -> stop the server.
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like "*$serverPath*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
