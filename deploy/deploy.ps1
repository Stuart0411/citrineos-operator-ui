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

Write-Host "Deploying image: $fullImage" -ForegroundColor Cyan
Write-Host "Publishing UI on host port: $($env:UI_HOST_PORT)" -ForegroundColor Cyan

$pullTimeoutSec = 240
Write-Host "Pulling image (timeout ${pullTimeoutSec}s)..." -ForegroundColor Cyan
$pullJob = Start-Job -ScriptBlock {
  param($composeFilePath)
  docker compose -f $composeFilePath pull
} -ArgumentList './deploy/docker-compose.release.yml'

if (-not (Wait-Job -Job $pullJob -Timeout $pullTimeoutSec)) {
  Stop-Job -Job $pullJob -ErrorAction SilentlyContinue | Out-Null
  Remove-Job -Job $pullJob -Force -ErrorAction SilentlyContinue | Out-Null
  throw "Timed out while pulling $fullImage after ${pullTimeoutSec}s. Verify tag exists in GHCR, network to ghcr.io, and docker login state."
}

Receive-Job -Job $pullJob
$pullExit = $pullJob.ChildJobs[0].JobStateInfo.State
Remove-Job -Job $pullJob -Force -ErrorAction SilentlyContinue | Out-Null
if ($LASTEXITCODE -ne 0 -or $pullExit -ne 'Completed') {
  throw "Failed to pull release image $fullImage. Verify the tag exists and run: docker pull $fullImage"
}

docker compose -f ./deploy/docker-compose.release.yml up -d --remove-orphans
if ($LASTEXITCODE -ne 0) {
  throw 'Failed to start release stack'
}

$containerId = (docker compose -f ./deploy/docker-compose.release.yml ps -q citrine-ui).Trim()
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
