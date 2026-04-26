$content = Get-Content -Raw "frontend/style.css"
$content = $content -replace '#chat-input\s*{[^}]*?align-self: center;', '$0'.Replace('align-self: center;', 'align-self: flex-end;').Replace('min-height: 38px;', 'min-height: 36px;')
$content = $content -replace '\.sidebar-header\s*{[^}]*?background: rgba\(0, 0, 0, 0\.1\);[^}]*?}', '$0'.Replace('background: rgba(0, 0, 0, 0.1);', 'background: transparent;').Replace('border-bottom: 1px solid var(--border-metal);', "border-top: none;`n    border-bottom: 1px solid var(--border-metal);")
Set-Content "frontend/style.css" $content -Encoding UTF8
Write-Output "PowerShell replacement done."
