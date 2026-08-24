# SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
#
# SPDX-License-Identifier: Apache-2.0

param(
  [Parameter(Mandatory = $true)]
  [string]$Image,

  [Parameter(Mandatory = $true)]
  [string]$Tag,

  [int]$HealthTimeoutSeconds = 180
)

$ErrorActionPreference = 'Stop'

$fullImage = "$Image`:$Tag"
$env:UI_IMAGE = $fullImage
if ([string]::IsNullOrWhiteSpace($env:UI_HOST_PORT)) {
  $env:UI_HOST_PORT = '3000'
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$composeFilePath = Join-Path $scriptDir 'docker-compose.release.yml'
if (-not (Test-Path $composeFilePath)) {
  throw "Compose file not found: $composeFilePath"
}

Write-Host "Deploying image: $fullImage" -ForegroundColor Cyan
Write-Host "Publishing UI on host port: $($env:UI_HOST_PORT)" -ForegroundColor Cyan

$pullTimeoutSec = 240
Write-Host "Pulling image (timeout ${pullTimeoutSec}s)..." -ForegroundColor Cyan
docker pull $fullImage
if ($LASTEXITCODE -ne 0) {
  throw "Failed to pull release image $fullImage. Verify the tag exists and run: docker pull $fullImage"
}

docker compose -f $composeFilePath up -d --remove-orphans
if ($LASTEXITCODE -ne 0) {
  throw 'Failed to start release stack'
}

$containerId = (docker compose -f $composeFilePath ps -q citrine-ui).Trim()
if ([string]::IsNullOrWhiteSpace($containerId)) {
  throw 'Could not resolve running container id for citrine-ui'
}

$deadline = (Get-Date).AddSeconds($HealthTimeoutSeconds)
$health = ''
while ((Get-Date) -lt $deadline) {
  $health = (docker inspect --format '{{.State.Health.Status}}' $containerId).Trim()
  if ($health -eq 'healthy') {
    Write-Host "Container is healthy: $containerId" -ForegroundColor Green
    Write-Host "Open: http://localhost:$($env:UI_HOST_PORT)/" -ForegroundColor Green
    exit 0
  }
  Start-Sleep -Seconds 3
}

throw "Timed out waiting for healthy container. Last health status: $health"
