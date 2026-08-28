Set-Location -LiteralPath $PSScriptRoot
$bat = Join-Path $PSScriptRoot 'start.bat'
$names = @(
  'AI-Video.lnk',
  ([string]::Concat([char]0x542F, [char]0x52A8, ' AI-Video.lnk'))
)

$shell = New-Object -ComObject WScript.Shell
foreach ($name in $names) {
  $lnkPath = Join-Path $PSScriptRoot $name
  $shortcut = $shell.CreateShortcut($lnkPath)
  $shortcut.TargetPath = $bat
  $shortcut.WorkingDirectory = $PSScriptRoot
  $shortcut.WindowStyle = 1
  $shortcut.Description = 'Start AI-Video studio at http://localhost:3000'
  $shortcut.IconLocation = "$env:SystemRoot\System32\imageres.dll,101"
  $shortcut.Save()
  Write-Host "Created: $lnkPath"
}

Write-Host 'Copy to Desktop or pin to taskbar. Double-click to start.'

