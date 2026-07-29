$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $projectRoot ".env.local"
$nodeScript = Join-Path $PSScriptRoot "create-first-admin.mjs"

if (-not (Test-Path -LiteralPath $envFile)) {
  throw "Arquivo .env.local não encontrado."
}

$password = Read-Host "Defina a senha do administrador (mínimo de 12 caracteres)" -AsSecureString
$confirmation = Read-Host "Confirme a senha" -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)
$confirmationPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($confirmation)

try {
  $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
  $plainConfirmation = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($confirmationPointer)
  $payload = $plainPassword + [Environment]::NewLine + $plainConfirmation + [Environment]::NewLine
  $payload | & node "--env-file=$envFile" $nodeScript
  if ($LASTEXITCODE -ne 0) {
    throw "O cadastro não foi concluído."
  }
} finally {
  $payload = $null
  $plainPassword = $null
  $plainConfirmation = $null
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($confirmationPointer)
}
