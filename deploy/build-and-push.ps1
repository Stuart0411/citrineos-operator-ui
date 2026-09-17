# SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
#
# SPDX-License-Identifier: Apache-2.0

param(
  [Parameter(Mandatory = $true)]
  [string]$Image,

  [Parameter(Mandatory = $true)]
  [string]$Tag,

  [switch]$AlsoTagLatest
)

$ErrorActionPreference = 'Stop'

function Import-EnvFile {
  param([string]$Path)

  if (-not (Test-Path $Path)) {
    return
  }

  Get-Content $Path | ForEach-Object {
    $line = $_.Trim()
    if ([string]::IsNullOrWhiteSpace($line) -or $line.StartsWith('#')) {
      return
    }

    $separatorIndex = $line.IndexOf('=')
    if ($separatorIndex -lt 1) {
      return
    }

    $name = $line.Substring(0, $separatorIndex).Trim()
    $value = $line.Substring($separatorIndex + 1).Trim()

    if ([string]::IsNullOrWhiteSpace($name)) {
      return
    }

    if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) {
      [Environment]::SetEnvironmentVariable($name, $value)
    }
  }
}

function Get-EnvValue {
  param([string[]]$Names)

  foreach ($name in $Names) {
    $value = [Environment]::GetEnvironmentVariable($name)
    if (-not [string]::IsNullOrWhiteSpace($value)) {
      return $value
    }
  }

  return $null
}

function Ensure-GhcrLogin {
  param([string]$RegistryImage)

  if (-not $RegistryImage.StartsWith('ghcr.io/', [System.StringComparison]::OrdinalIgnoreCase)) {
    return
  }

  $username = Get-EnvValue @('GHCR_USERNAME', 'GITHUB_ACTOR', 'GITHUB_USERNAME')
  $token = Get-EnvValue @('GHCR_TOKEN', 'GITHUB_TOKEN', 'CR_PAT')

  if ([string]::IsNullOrWhiteSpace($username) -or [string]::IsNullOrWhiteSpace($token)) {
    throw @(
      'Missing GHCR credentials for image push.'
      'Set username env var: GHCR_USERNAME (or GITHUB_ACTOR/GITHUB_USERNAME).'
      'Set token env var: GHCR_TOKEN (or GITHUB_TOKEN/CR_PAT).'
      'Token must include package write permissions for ghcr.io.'
    ) -join [Environment]::NewLine
  }

  Write-Host "Authenticating to ghcr.io as $username" -ForegroundColor Cyan
  $token | docker login ghcr.io -u $username --password-stdin | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw 'Failed to authenticate to ghcr.io. Verify username/token and package permissions.'
  }
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Import-EnvFile -Path (Join-Path $scriptDir 'ui.runtime.env')

$requiredBuildArgs = @(
  'NEXT_PUBLIC_API_URL',
  'NEXT_PUBLIC_WS_URL',
  'NEXT_PUBLIC_CITRINE_CORE_URL',
  'NEXT_PUBLIC_FILE_SERVER_URL',
  'NEXTAUTH_URL'
)

$buildArgList = @()
foreach ($name in $requiredBuildArgs) {
  $value = [Environment]::GetEnvironmentVariable($name)
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "Missing required build arg environment variable: $name"
  }
  $buildArgList += @('--build-arg', "$name=$value")
}

$fullImage = "$Image`:$Tag"
Write-Host "Building and pushing $fullImage" -ForegroundColor Cyan

Ensure-GhcrLogin -RegistryImage $Image

$cmd = @(
  'buildx', 'build',
  '--platform', 'linux/amd64',
  '--file', 'Dockerfile',
  '--tag', $fullImage,
  '--push'
) + $buildArgList + @('.')

& docker @cmd
if ($LASTEXITCODE -ne 0) {
  throw "docker buildx build failed for $fullImage"
}

docker buildx imagetools inspect $fullImage | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Push verification failed for $fullImage"
}

if ($AlsoTagLatest) {
  $latestImage = "$Image`:latest"
  Write-Host "Also publishing $latestImage" -ForegroundColor Cyan
  docker buildx imagetools create --tag $latestImage $fullImage
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to publish $latestImage"
  }

  docker buildx imagetools inspect $latestImage | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Push verification failed for $latestImage"
  }
}

Write-Host "Done. Published image: $fullImage" -ForegroundColor Green
