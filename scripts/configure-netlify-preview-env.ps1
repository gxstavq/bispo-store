$ErrorActionPreference = "Stop"

$siteId = "d231fd13-72c6-4ec5-8a70-adfc9e31b79b"

function Set-PreviewVariable {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Value,
    [Parameter(Mandatory = $true)][string[]]$Scopes,
    [switch]$Secret
  )

  $scopeArguments = @(
    "--yes",
    "netlify-cli@latest",
    "env:set",
    $Name,
    "--site",
    $siteId,
    "--scope"
  ) + $Scopes + @("--force")

  $scopeDiagnostic = & npx @scopeArguments 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Falha ao restringir o escopo de $Name."
  }

  $valueArguments = @(
    "--yes",
    "netlify-cli@latest",
    "env:set",
    $Name,
    $Value,
    "--site",
    $siteId,
    "--context",
    "deploy-preview",
    "--force"
  )

  if ($Secret) {
    $valueArguments += "--secret"
  }

  $diagnostic = & npx @valueArguments 2>&1
  if ($LASTEXITCODE -ne 0) {
    $redacted = (($diagnostic | Out-String) -replace [regex]::Escape($Value), "[REDACTED]").Trim()
    throw "Falha ao configurar $Name no Deploy Preview: $redacted"
  }

  $kind = if ($Secret) { "segredo server-side" } else { $Scopes -join "," }
  Write-Output "Configurada: $Name ($kind)"
}

$publicVariables = [ordered]@{
  NEXT_PUBLIC_SITE_URL = $env:NEXT_PUBLIC_SITE_URL
  NEXT_PUBLIC_SUPABASE_URL = $env:NEXT_PUBLIC_SUPABASE_URL
  NEXT_PUBLIC_SUPABASE_ANON_KEY = $env:NEXT_PUBLIC_SUPABASE_ANON_KEY
  NEXT_PUBLIC_WHATSAPP_NUMBER = $env:NEXT_PUBLIC_WHATSAPP_NUMBER
}

$serverVariables = [ordered]@{
  MELHOR_ENVIO_CLIENT_ID = $env:MELHOR_ENVIO_CLIENT_ID
  MELHOR_ENVIO_REDIRECT_URI = $env:MELHOR_ENVIO_REDIRECT_URI
  MELHOR_ENVIO_ENV = $env:MELHOR_ENVIO_ENV
  INTEGRATION_USER_AGENT = $env:INTEGRATION_USER_AGENT
  ENABLE_MELHOR_ENVIO_LABEL_PURCHASE = "false"
}

$serverSecrets = [ordered]@{
  SUPABASE_SERVICE_ROLE_KEY = $env:SUPABASE_SERVICE_ROLE_KEY
  INTEGRATION_ENCRYPTION_KEY = $env:INTEGRATION_ENCRYPTION_KEY
  MELHOR_ENVIO_CLIENT_SECRET = $env:MELHOR_ENVIO_CLIENT_SECRET
}

foreach ($entry in $publicVariables.GetEnumerator()) {
  Set-PreviewVariable -Name $entry.Key -Value $entry.Value -Scopes @("builds", "functions", "runtime")
}
foreach ($entry in $serverVariables.GetEnumerator()) {
  Set-PreviewVariable -Name $entry.Key -Value $entry.Value -Scopes @("functions")
}
foreach ($entry in $serverSecrets.GetEnumerator()) {
  Set-PreviewVariable -Name $entry.Key -Value $entry.Value -Scopes @("functions") -Secret
}
