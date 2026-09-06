param(
  [string]$Title = "TURF MATRIX",
  [Parameter(Mandatory = $true)]
  [string]$Message
)

$ErrorActionPreference = "Stop"

if ($Message.Length -gt 320) {
  $Message = "Automatic update failed. Check the TURF MATRIX runtime alert for details."
}

[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null

$escapedTitle = [System.Security.SecurityElement]::Escape($Title)
$escapedMessage = [System.Security.SecurityElement]::Escape($Message)
$toastXml = @"
<toast duration="long">
  <visual>
    <binding template="ToastGeneric">
      <text>$escapedTitle</text>
      <text>$escapedMessage</text>
    </binding>
  </visual>
  <audio src="ms-winsoundevent:Notification.Looping.Alarm2" loop="false" />
</toast>
"@

$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml($toastXml)
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
$appId = "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe"
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)

$msgExe = Join-Path $env:SystemRoot "System32\msg.exe"
if (Test-Path -LiteralPath $msgExe) {
  try {
    & $msgExe $env:USERNAME /TIME:120 "$Title`n$Message" 2>$null | Out-Null
  } catch {
    # The toast remains the primary notification when no interactive message session is available.
  }
}

Write-Output "Windows notification dispatched."
