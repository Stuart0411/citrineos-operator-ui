// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
'use client';

import type { ChargingStationDto, EvseDto } from '@citrineos/base';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@lib/client/components/ui/card';
import { Badge } from '@lib/client/components/ui/badge';
import { Button } from '@lib/client/components/ui/button';
import { Combobox } from '@lib/client/components/combobox';
import { Input } from '@lib/client/components/ui/input';
import { Label } from '@lib/client/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@lib/client/components/ui/select';
import { Textarea } from '@lib/client/components/ui/textarea';
import { Switch } from '@lib/client/components/ui/switch';
import { OverviewCardSkeleton } from '@lib/client/pages/overview/overview.card.skeleton';
import { CHARGING_STATIONS_LIST_QUERY } from '@lib/queries/charging.stations';
import { BaseRestClient } from '@lib/utils/BaseRestClient';
import { ResourceType } from '@lib/utils/access.types';
import config from '@lib/utils/config';
import { MenuSection } from '@lib/client/components/main-menu/main.menu';
import { ChevronRight, RefreshCw, X, Zap } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useList } from '@refinedev/core';

type EmsSiteIntent = {
  siteId: string;
  messageId?: string | null;
  intentCreatedAt?: string | null;
  expiresAt?: string | null;
  source?: {
    system?: string | null;
    instance?: string | null;
    component?: string | null;
  } | null;
  mode?: string | null;
  constraints?: {
    maxExportW?: number | null;
    maxImportW?: number | null;
    evChargeBudgetW?: number | null;
    evDischargeBudgetW?: number | null;
    rampRateWPerSec?: number | null;
  } | null;
  flags?: {
    allowDischarge?: boolean | null;
    emergencyCurtailment?: boolean | null;
  } | null;
  reason?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type EmsIntakeTelemetrySummary = {
  tenantId: number;
  siteId: string | null;
  total: number;
  accepted: number;
  rejected: number;
  byReasonCode: Record<string, number>;
  latestCreatedAt: string | null;
};

type EmsChargingPlanRequest = {
  siteId: string;
  stationIds: string[];
  evseId: number;
  strategy: 'equal_share_online' | 'equal_share_all';
  chargingProfilePurpose:
    | 'ChargingStationExternalConstraints'
    | 'ChargingStationMaxProfile'
    | 'PriorityCharging'
    | 'LocalGeneration'
    | 'TxDefaultProfile'
    | 'TxProfile';
  operationMode:
    | 'ChargingOnly'
    | 'ExternalLimits'
    | 'CentralSetpoint'
    | 'ExternalSetpoint'
    | 'LocalFrequency'
    | 'LocalLoadBalancing'
    | 'Idle';
  applicationPath: 'absolute' | 'dynamic';
};

type EmsStationOption = ChargingStationDto & {
  location?: {
    name?: string | null;
  } | null;
};

type EmsPlanAction = 'derive' | 'apply' | 'reconcile';

type EmsPlanRecommendation = {
  stationId: string;
  eligible: boolean;
  limitW: number;
  operationMode: string;
  exportAllowed?: boolean;
  dischargeLimitW?: number | null;
};

type EmsPlanResponsePayload = {
  recommendations?: EmsPlanRecommendation[];
  results?: Array<{
    stationId: string;
    applied: boolean;
    success?: boolean;
    reason?: string | null;
    profileId?: number | null;
    scheduleId?: number | null;
    payload?: unknown;
  }>;
};

type EmsIntentOverrideConfig = {
  enabled: boolean;
  allowDischarge: boolean;
  dischargeBudgetW: string;
  useCentralSetpointDischargeAsBudget: boolean;
  centralSetpointDischargeLimitW: string;
  ttlSeconds: number;
};

type EmsAutoApplyConfig = {
  siteId: string;
  stationIds: string[];
  evseId: number;
  strategy: EmsChargingPlanRequest['strategy'];
  chargingProfilePurpose: EmsChargingPlanRequest['chargingProfilePurpose'];
  operationMode: EmsChargingPlanRequest['operationMode'];
  applicationPath: EmsChargingPlanRequest['applicationPath'];
  enabled: boolean;
};

type EmsOperationsCardProps = {
  showOverview?: boolean;
  showBuilder?: boolean;
};

const client = new BaseRestClient(null);
const siteId = 'nexus';
const tenantId = Number(config.tenantId || '1');

const formatDateTime = (value?: string | null) => {
  if (!value) {
    return 'n/a';
  }

  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
};

const formatPower = (value?: number | null) => {
  if (value == null) {
    return 'n/a';
  }

  return `${value.toLocaleString()} W`;
};

const toStationId = (
  station: Pick<EmsStationOption, 'id'>,
): string | undefined => {
  if (station.id == null) {
    return undefined;
  }

  return String(station.id);
};

const getCommonEvses = (
  stations: EmsStationOption[],
  stationIds: string[],
): EvseDto[] => {
  const selectedStations = stationIds
    .map((stationId) =>
      stations.find((station) => toStationId(station) === stationId),
    )
    .filter((station): station is EmsStationOption => Boolean(station));

  if (selectedStations.length === 0) {
    return [];
  }

  const evseIdSets = selectedStations.map(
    (station) =>
      new Set((station.evses ?? []).map((evse) => Number(evse.evseTypeId))),
  );

  const commonIds = [...evseIdSets[0]].filter((evseId) =>
    evseIdSets.every((evseSet) => evseSet.has(evseId)),
  );

  return commonIds
    .map((evseId) =>
      (selectedStations[0].evses ?? []).find(
        (evse) => Number(evse.evseTypeId) === evseId,
      ),
    )
    .filter((evse): evse is EvseDto => Boolean(evse))
    .sort((left, right) => Number(left.evseTypeId) - Number(right.evseTypeId));
};

export const EmsOperationsCard = ({
  showOverview = true,
  showBuilder = true,
}: EmsOperationsCardProps) => {
  const {
    query: { data: stationsData },
  } = useList<EmsStationOption>({
    resource: ResourceType.CHARGING_STATIONS,
    meta: {
      gqlQuery: CHARGING_STATIONS_LIST_QUERY,
      gqlVariables: {
        offset: 0,
        limit: 200,
      },
    },
    pagination: { mode: 'off' },
  });
  const [currentIntent, setCurrentIntent] = useState<EmsSiteIntent | null>(
    null,
  );
  const [telemetry, setTelemetry] = useState<EmsIntakeTelemetrySummary | null>(
    null,
  );
  const [planRequest, setPlanRequest] = useState<EmsChargingPlanRequest>({
    siteId,
    stationIds: [],
    evseId: 1,
    strategy: 'equal_share_online',
    chargingProfilePurpose: 'ChargingStationExternalConstraints',
    operationMode: 'ExternalLimits',
    applicationPath: 'absolute',
  });
  const [planAction, setPlanAction] = useState<EmsPlanAction | null>(null);
  const [planResponse, setPlanResponse] = useState<string | null>(null);
  const [planResponsePayload, setPlanResponsePayload] =
    useState<EmsPlanResponsePayload | null>(null);
  const [intentOverride, setIntentOverride] = useState<EmsIntentOverrideConfig>(
    {
      enabled: false,
      allowDischarge: false,
      dischargeBudgetW: '',
      useCentralSetpointDischargeAsBudget: true,
      centralSetpointDischargeLimitW: '',
      ttlSeconds: 45,
    },
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [autoApplyConfig, setAutoApplyConfig] =
    useState<EmsAutoApplyConfig | null>(null);
  const [autoApplySaving, setAutoApplySaving] = useState(false);

  useEffect(() => {
    let mounted = true;

    const load = async (showInitialLoader = false) => {
      try {
        setError(null);
        if (showInitialLoader) {
          setLoading(true);
        }

        const [intentResponse, telemetryResponse, autoApplyResponse] =
          await Promise.all([
            client.getRaw<EmsSiteIntent[]>(
              `/ems/emsSiteIntent?tenantId=${tenantId}&siteId=${encodeURIComponent(siteId)}&currentOnly=true`,
            ),
            client.getRaw<EmsIntakeTelemetrySummary>(
              `/ems/emsIntakeTelemetry?tenantId=${tenantId}&siteId=${encodeURIComponent(siteId)}&limit=50`,
            ),
            client
              .getRaw<
                EmsAutoApplyConfig[]
              >(`/ems/emsAutoApply?tenantId=${tenantId}`)
              .catch(() => ({ data: [] as EmsAutoApplyConfig[] })),
          ]);

        if (!mounted) {
          return;
        }

        setCurrentIntent(intentResponse.data[0] ?? null);
        setTelemetry(telemetryResponse.data);
        const matchingConfig = (
          autoApplyResponse.data as EmsAutoApplyConfig[]
        ).find((c) => c.siteId === siteId);
        setAutoApplyConfig(matchingConfig ?? null);
      } catch (err) {
        if (!mounted) {
          return;
        }

        setError(
          err instanceof Error ? err.message : 'Unable to load EMS operations',
        );
      } finally {
        if (mounted && showInitialLoader) {
          setLoading(false);
        }
      }
    };

    void load(true);

    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') {
        return;
      }
      void load();
    }, 30000);

    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!currentIntent?.siteId) {
      return;
    }

    setPlanRequest((current) => {
      if (current.siteId && current.siteId !== siteId) {
        return current;
      }

      return {
        ...current,
        siteId: currentIntent.siteId,
      };
    });
  }, [currentIntent?.siteId]);

  if (loading) {
    return <OverviewCardSkeleton />;
  }

  const activeLimits = currentIntent?.constraints;
  const hasIntent = Boolean(currentIntent);
  const cardTitle =
    showBuilder && !showOverview ? 'EMS plan builder' : 'EMS live site';
  const cardDescription =
    showBuilder && !showOverview
      ? 'Build and apply EMS charging plans with optional site-intent override controls.'
      : 'Current site intent and intake telemetry for live ODE-driven testing.';
  const accepted = telemetry?.accepted ?? 0;
  const rejected = telemetry?.rejected ?? 0;
  const activeReasonCode = telemetry
    ? Object.entries(telemetry.byReasonCode).sort((a, b) => b[1] - a[1])[0]
    : undefined;
  const stations: EmsStationOption[] = stationsData?.data ?? [];
  const selectedStations = planRequest.stationIds
    .map((stationId) =>
      stations.find((station) => toStationId(station) === stationId),
    )
    .filter((station): station is EmsStationOption => Boolean(station));
  const availableEvses = getCommonEvses(stations, planRequest.stationIds);
  const stationOptions = stations
    .map((station) => {
      const id = toStationId(station);
      if (!id) {
        return null;
      }

      return {
        label: station.location?.name ? `${id} - ${station.location.name}` : id,
        value: id,
      };
    })
    .filter((option): option is { label: string; value: string } =>
      Boolean(option),
    );

  const setPlanField = <K extends keyof EmsChargingPlanRequest>(
    key: K,
    value: EmsChargingPlanRequest[K],
  ) => {
    setPlanRequest((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const parseStationIds = (value: string) =>
    value
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean);

  const handleStationSelect = (stationId: string) => {
    const station = stations.find((item) => toStationId(item) === stationId);
    const nextEvseId = station?.evses?.[0]?.evseTypeId;

    setPlanRequest((current) => ({
      ...current,
      stationIds: current.stationIds.includes(stationId)
        ? current.stationIds
        : [...current.stationIds, stationId],
      evseId: nextEvseId ? Number(nextEvseId) : current.evseId,
    }));
  };

  const removeStation = (stationId: string) => {
    setPlanRequest((current) => ({
      ...current,
      stationIds: current.stationIds.filter((item) => item !== stationId),
    }));
  };

  const parsePositiveNumberInput = (value: string): number | undefined => {
    const normalized = value.trim();
    if (!normalized) {
      return undefined;
    }

    const parsed = Number(normalized);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return undefined;
    }

    return parsed;
  };

  const toErrorMessage = (err: unknown, fallback: string): string => {
    if (!err || typeof err !== 'object') {
      return fallback;
    }

    const maybeError = err as {
      message?: unknown;
      response?: {
        data?: unknown;
      };
    };

    const responseData = maybeError.response?.data;
    if (typeof responseData === 'string' && responseData.trim()) {
      return responseData;
    }

    if (responseData && typeof responseData === 'object') {
      const maybePayload = responseData as {
        message?: unknown;
        error?: unknown;
      };
      if (
        typeof maybePayload.message === 'string' &&
        maybePayload.message.trim()
      ) {
        return maybePayload.message;
      }
      if (typeof maybePayload.error === 'string' && maybePayload.error.trim()) {
        return maybePayload.error;
      }
      try {
        return JSON.stringify(responseData);
      } catch {
        // Use fallback below when response payload is not serializable.
      }
    }

    if (typeof maybeError.message === 'string' && maybeError.message.trim()) {
      return maybeError.message;
    }

    return fallback;
  };

  const createMessageId = (): string => {
    if (typeof crypto !== 'undefined') {
      if (typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }

      if (typeof crypto.getRandomValues === 'function') {
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = Array.from(bytes, (b) =>
          b.toString(16).padStart(2, '0'),
        ).join('');
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      }
    }

    return '00000000-0000-0000-0000-000000000000';
  };

  const formatWatts = (value?: number | null) => {
    if (typeof value !== 'number') {
      return 'n/a';
    }
    return `${Math.round(value).toLocaleString()} W`;
  };

  const publishIntentOverride = async (trimmedSiteId: string) => {
    const createdAt = new Date();
    const ttlSeconds = Math.max(
      15,
      Math.floor(intentOverride.ttlSeconds || 45),
    );
    const expiresAt = new Date(createdAt.getTime() + ttlSeconds * 1000);

    const explicitDischargeBudget = parsePositiveNumberInput(
      intentOverride.dischargeBudgetW,
    );
    const centralSetpointDischargeBudget = parsePositiveNumberInput(
      intentOverride.centralSetpointDischargeLimitW,
    );
    const existingDischargeBudget =
      currentIntent?.constraints?.evDischargeBudgetW ?? undefined;

    const dischargeBudgetFromCentralSetpoint =
      planRequest.operationMode === 'CentralSetpoint' &&
      intentOverride.useCentralSetpointDischargeAsBudget
        ? centralSetpointDischargeBudget
        : undefined;

    const resolvedDischargeBudget =
      explicitDischargeBudget ??
      dischargeBudgetFromCentralSetpoint ??
      existingDischargeBudget;

    if (
      intentOverride.allowDischarge &&
      typeof resolvedDischargeBudget !== 'number'
    ) {
      throw new Error(
        'Allow discharge is enabled but no discharge budget is set. Enter Discharge budget W or enable CentralSetpoint budget fallback with a value.',
      );
    }

    const messageId = createMessageId();

    const intentBody = {
      messageId,
      siteId: trimmedSiteId,
      source: {
        system: 'operator-ui',
        component: 'ems-plan-builder',
        instance: 'manual-intent-override',
      },
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      mode: planRequest.operationMode,
      constraints: {
        maxImportW: currentIntent?.constraints?.maxImportW ?? null,
        maxExportW: currentIntent?.constraints?.maxExportW ?? null,
        evChargeBudgetW: currentIntent?.constraints?.evChargeBudgetW ?? null,
        evDischargeBudgetW: intentOverride.allowDischarge
          ? (resolvedDischargeBudget ?? null)
          : null,
        rampRateWPerSec: currentIntent?.constraints?.rampRateWPerSec ?? null,
      },
      flags: {
        allowDischarge: intentOverride.allowDischarge,
        emergencyCurtailment:
          currentIntent?.flags?.emergencyCurtailment === true,
      },
      reason: 'operator_ui_manual_intent_override',
      metadata: {
        source: 'ems-plan-builder',
        override: true,
        useCentralSetpointDischargeAsBudget:
          intentOverride.useCentralSetpointDischargeAsBudget,
      },
    };

    await client.postRaw(`/ems/emsSiteIntent?tenantId=${tenantId}`, intentBody);
  };

  const saveAutoApplyConfig = async (enabled: boolean) => {
    const stationIds = planRequest.stationIds
      .map((s) => s.trim())
      .filter(Boolean);
    if (stationIds.length === 0) {
      setPlanError('Add at least one station before enabling auto-apply.');
      return;
    }
    setAutoApplySaving(true);
    try {
      const config: EmsAutoApplyConfig = {
        siteId: planRequest.siteId.trim() || siteId,
        stationIds,
        evseId: planRequest.evseId,
        strategy: planRequest.strategy,
        chargingProfilePurpose: planRequest.chargingProfilePurpose,
        operationMode: planRequest.operationMode,
        applicationPath: planRequest.applicationPath,
        enabled,
      };
      const saved = await client.postRaw<EmsAutoApplyConfig>(
        `/ems/emsAutoApply?tenantId=${tenantId}`,
        config,
      );
      setAutoApplyConfig(saved.data);
    } catch (err) {
      setPlanError(toErrorMessage(err, 'Failed to save auto-apply config'));
    } finally {
      setAutoApplySaving(false);
    }
  };

  const removeAutoApplyConfig = async () => {
    setAutoApplySaving(true);
    try {
      await client.delRaw(
        `/ems/emsAutoApply?tenantId=${tenantId}&siteId=${encodeURIComponent(planRequest.siteId.trim() || siteId)}`,
      );
      setAutoApplyConfig(null);
    } catch {
      // Ignore delete errors silently.
    } finally {
      setAutoApplySaving(false);
    }
  };

  const runPlanAction = async (action: EmsPlanAction) => {
    setPlanAction(action);
    setPlanError(null);
    setPlanResponse(null);
    setPlanResponsePayload(null);

    const trimmedSiteId = planRequest.siteId.trim();
    const stationIds = planRequest.stationIds
      .map((item) => item.trim())
      .filter(Boolean);

    if (!trimmedSiteId) {
      setPlanError('Site id is required.');
      setPlanAction(null);
      return;
    }

    if (stationIds.length === 0) {
      setPlanError(
        'Add at least one station id. Use commas or new lines to separate multiple stations.',
      );
      setPlanAction(null);
      return;
    }

    const requestBody: EmsChargingPlanRequest = {
      ...planRequest,
      siteId: trimmedSiteId,
      stationIds,
      evseId:
        Number.isFinite(planRequest.evseId) && planRequest.evseId > 0
          ? planRequest.evseId
          : 1,
    };

    try {
      if (intentOverride.enabled) {
        await publishIntentOverride(trimmedSiteId);
      }

      const endpoint = `/ems/emsChargingPlan?tenantId=${tenantId}`;
      const response =
        action === 'derive'
          ? await client.postRaw(endpoint, requestBody)
          : action === 'apply'
            ? await client.putRaw(endpoint, requestBody)
            : await client.patchRaw(endpoint, requestBody);

      setPlanResponsePayload(response.data as EmsPlanResponsePayload);
      setPlanResponse(JSON.stringify(response.data, null, 2));
    } catch (err) {
      setPlanError(
        toErrorMessage(err, `Unable to ${action} EMS charging plan`),
      );
    } finally {
      setPlanAction(null);
    }
  };

  return (
    <Card className="flex h-full min-h-[36rem] max-h-[75vh] flex-col overflow-hidden border-border/70 bg-card/80 shadow-sm backdrop-blur-sm">
      <CardHeader className="border-b border-border/60 bg-gradient-to-r from-primary/10 via-background to-secondary/10">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <CardTitle className="flex items-center gap-2 text-xl">
              <Zap className="size-5 text-primary" />
              {cardTitle}
            </CardTitle>
            <CardDescription>{cardDescription}</CardDescription>
          </div>
          {showOverview ? (
            <Badge variant={hasIntent ? 'success' : 'destructive'}>
              {hasIntent ? 'Active' : 'No active intent'}
            </Badge>
          ) : (
            <Badge variant="outline">Builder</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="grid flex-1 gap-6 overflow-y-auto p-6">
        {error ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
            {error}
          </div>
        ) : (
          <>
            {showOverview ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-border/60 bg-background/70 p-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">
                    Site intent
                  </p>
                  <div className="mt-3 space-y-2">
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-sm text-muted-foreground">
                        Site
                      </span>
                      <span className="font-medium">
                        {currentIntent?.siteId ?? siteId}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-sm text-muted-foreground">
                        Mode
                      </span>
                      <span className="font-medium">
                        {currentIntent?.mode ?? 'n/a'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-sm text-muted-foreground">
                        Export limit
                      </span>
                      <span className="font-medium">
                        {formatPower(activeLimits?.maxExportW ?? null)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-sm text-muted-foreground">
                        Import limit
                      </span>
                      <span className="font-medium">
                        {formatPower(activeLimits?.maxImportW ?? null)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-border/60 bg-background/70 p-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">
                    Intake telemetry
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div className="rounded-lg bg-card/80 p-3">
                      <p className="text-xs text-muted-foreground">Accepted</p>
                      <p className="mt-1 text-2xl font-semibold">{accepted}</p>
                    </div>
                    <div className="rounded-lg bg-card/80 p-3">
                      <p className="text-xs text-muted-foreground">Rejected</p>
                      <p className="mt-1 text-2xl font-semibold">{rejected}</p>
                    </div>
                    <div className="rounded-lg bg-card/80 p-3 col-span-2">
                      <p className="text-xs text-muted-foreground">
                        Latest update
                      </p>
                      <p className="mt-1 text-sm font-medium">
                        {formatDateTime(telemetry?.latestCreatedAt)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Top reason code: {activeReasonCode?.[0] ?? 'n/a'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {showBuilder ? (
              <div className="rounded-xl border border-border/60 bg-background/70 p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">
                      EMS plan builder
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      This submits the backend EMS request directly. It derives,
                      applies, or reconciles against the active site intent
                      using the station ids you enter here.
                    </p>
                  </div>
                  <Badge variant="outline" className="w-fit">
                    Backend-driven
                  </Badge>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div className="space-y-2 md:col-span-2">
                    <Label>Charging stations</Label>
                    <Combobox<string>
                      options={stationOptions}
                      skipValue
                      onSelect={(value) => handleStationSelect(value)}
                      placeholder="Add a charging station"
                      searchPlaceholder="Search charging stations"
                      emptyMessage="No charging stations found"
                      disabled={stationOptions.length === 0}
                    />
                    {selectedStations.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {selectedStations.map((station) => (
                          <Badge
                            key={toStationId(station) ?? 'unknown-station'}
                            variant="secondary"
                            className="gap-2 pr-1"
                          >
                            <span>
                              {station.location?.name
                                ? `${toStationId(station) ?? 'unknown'} - ${station.location.name}`
                                : (toStationId(station) ?? 'unknown')}
                            </span>
                            <button
                              type="button"
                              aria-label={`Remove ${toStationId(station) ?? 'station'}`}
                              className="rounded-sm p-1 text-muted-foreground transition hover:bg-background/70 hover:text-foreground"
                              onClick={() => {
                                const id = toStationId(station);
                                if (id) {
                                  removeStation(id);
                                }
                              }}
                            >
                              <X className="size-3" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ems-site-id">Site id</Label>
                    <Input
                      id="ems-site-id"
                      value={planRequest.siteId}
                      onChange={(event) =>
                        setPlanField('siteId', event.target.value)
                      }
                      placeholder="nexus"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ems-evse-id">EVSE id</Label>
                    {availableEvses.length > 0 ? (
                      <Select
                        value={String(planRequest.evseId)}
                        onValueChange={(value) =>
                          setPlanField('evseId', Number(value))
                        }
                      >
                        <SelectTrigger id="ems-evse-id">
                          <SelectValue placeholder="Select EVSE" />
                        </SelectTrigger>
                        <SelectContent>
                          {availableEvses.map((evse) => (
                            <SelectItem
                              key={String(evse.id)}
                              value={String(evse.evseTypeId)}
                            >
                              EVSE {String(evse.evseTypeId)}
                              {evse.physicalReference
                                ? ` - ${evse.physicalReference}`
                                : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        id="ems-evse-id"
                        type="number"
                        min={1}
                        value={planRequest.evseId}
                        onChange={(event) =>
                          setPlanField('evseId', Number(event.target.value))
                        }
                      />
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ems-strategy">Strategy</Label>
                    <Select
                      value={planRequest.strategy}
                      onValueChange={(value) =>
                        setPlanField(
                          'strategy',
                          value as EmsChargingPlanRequest['strategy'],
                        )
                      }
                    >
                      <SelectTrigger id="ems-strategy">
                        <SelectValue placeholder="Select strategy" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="equal_share_online">
                          Equal share online
                        </SelectItem>
                        <SelectItem value="equal_share_all">
                          Equal share all
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ems-purpose">
                      Charging profile purpose
                    </Label>
                    <Select
                      value={planRequest.chargingProfilePurpose}
                      onValueChange={(value) =>
                        setPlanField(
                          'chargingProfilePurpose',
                          value as EmsChargingPlanRequest['chargingProfilePurpose'],
                        )
                      }
                    >
                      <SelectTrigger id="ems-purpose">
                        <SelectValue placeholder="Select profile purpose" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ChargingStationExternalConstraints">ChargingStationExternalConstraints</SelectItem>
                        <SelectItem value="ChargingStationMaxProfile">ChargingStationMaxProfile</SelectItem>
                        <SelectItem value="TxDefaultProfile">TxDefaultProfile</SelectItem>
                        <SelectItem value="TxProfile">TxProfile</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ems-mode">Operation mode</Label>
                    <Select
                      value={planRequest.operationMode}
                      onValueChange={(value) =>
                        setPlanField(
                          'operationMode',
                          value as EmsChargingPlanRequest['operationMode'],
                        )
                      }
                    >
                      <SelectTrigger id="ems-mode">
                        <SelectValue placeholder="Select operation mode" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ExternalLimits">
                          ExternalLimits
                        </SelectItem>
                        <SelectItem value="ChargingOnly">
                          ChargingOnly
                        </SelectItem>
                        <SelectItem value="CentralSetpoint">
                          CentralSetpoint
                        </SelectItem>
                        <SelectItem value="ExternalSetpoint">
                          ExternalSetpoint
                        </SelectItem>
                        <SelectItem value="LocalFrequency">
                          LocalFrequency
                        </SelectItem>
                        <SelectItem value="LocalLoadBalancing">
                          LocalLoadBalancing
                        </SelectItem>
                        <SelectItem value="Idle">Idle</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2 md:col-span-2 rounded-lg border border-border/60 bg-card/60 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">Application path</p>
                        <p className="text-xs text-muted-foreground">
                          Absolute sends SetChargingProfile. Dynamic sends UpdateDynamicSchedule on OCPP 2.1 stations with an active Dynamic profile.
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground">Absolute</span>
                        <Switch
                          checked={planRequest.applicationPath === 'dynamic'}
                          onCheckedChange={(checked) =>
                            setPlanField(
                              'applicationPath',
                              checked ? 'dynamic' : 'absolute',
                            )
                          }
                        />
                        <span className="text-xs text-muted-foreground">Dynamic</span>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2 md:col-span-2 rounded-lg border border-border/60 bg-card/60 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">
                          Intent override (no MQTT required)
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Publish an EMS site intent override from this form
                          before running derive, apply, or reconcile.
                        </p>
                      </div>
                      <Switch
                        checked={intentOverride.enabled}
                        onCheckedChange={(checked) =>
                          setIntentOverride((current) => ({
                            ...current,
                            enabled: checked,
                          }))
                        }
                      />
                    </div>

                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <Label htmlFor="ems-allow-discharge-toggle">Allow discharging</Label>
                          <Switch
                            id="ems-allow-discharge-toggle"
                            checked={intentOverride.allowDischarge}
                            onCheckedChange={(checked) =>
                              setIntentOverride((current) => ({ ...current, allowDischarge: checked }))
                            }
                            disabled={!intentOverride.enabled}
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="ems-discharge-budget">Discharge budget W</Label>
                        <Input
                          id="ems-discharge-budget"
                          type="number"
                          min={0}
                          placeholder="e.g. 3000"
                          value={intentOverride.dischargeBudgetW}
                          onChange={(event) =>
                            setIntentOverride((current) => ({ ...current, dischargeBudgetW: event.target.value }))
                          }
                          disabled={!intentOverride.enabled || !intentOverride.allowDischarge}
                        />
                      </div>
                      <div className="space-y-2 md:col-span-2">
                        <Label htmlFor="ems-intent-ttl">Intent TTL seconds</Label>
                        <Input
                          id="ems-intent-ttl"
                          type="number"
                          min={15}
                          value={intentOverride.ttlSeconds}
                          onChange={(event) =>
                            setIntentOverride((current) => ({
                              ...current,
                              ttlSeconds: Number(event.target.value) || 45,
                            }))
                          }
                          disabled={!intentOverride.enabled}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {planError ? (
                  <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                    {planError}
                  </div>
                ) : null}

                {/* Auto-apply section */}
                <div className="mt-4 rounded-lg border border-border/60 bg-card/60 p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">
                        Auto-apply on MQTT update
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Automatically dispatch the current profile to these
                        stations every time a new intent arrives from the ODE
                        MQTT topic.
                      </p>
                    </div>
                    <Switch
                      checked={autoApplyConfig?.enabled === true}
                      disabled={autoApplySaving}
                      onCheckedChange={(checked) =>
                        void saveAutoApplyConfig(checked)
                      }
                    />
                  </div>
                  {autoApplyConfig ? (
                    <div className="rounded-lg bg-background/60 p-3 space-y-1">
                      <p className="text-xs text-muted-foreground">
                        Currently registered:
                      </p>
                      <p className="text-xs font-medium">
                        {autoApplyConfig.stationIds.join(', ')}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {autoApplyConfig.chargingProfilePurpose} ·{' '}
                        {autoApplyConfig.operationMode} · EVSE{' '}
                        {autoApplyConfig.applicationPath === 'dynamic' ? 'dynamic path' : 'absolute path'} ·{' '}
                        {autoApplyConfig.evseId} ·{' '}
                        {autoApplyConfig.enabled ? 'active' : 'paused'}
                      </p>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="mt-1 text-destructive hover:text-destructive"
                        disabled={autoApplySaving}
                        onClick={() => void removeAutoApplyConfig()}
                      >
                        Remove auto-apply config
                      </Button>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Enable the toggle above to register the current station
                      selection.
                    </p>
                  )}
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    onClick={() => void runPlanAction('derive')}
                    disabled={planAction !== null}
                  >
                    {planAction === 'derive' ? 'Deriving...' : 'Derive plan'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void runPlanAction('apply')}
                    disabled={planAction !== null}
                  >
                    {planAction === 'apply' ? 'Applying...' : 'Apply plan'}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => void runPlanAction('reconcile')}
                    disabled={planAction !== null}
                  >
                    {planAction === 'reconcile'
                      ? 'Reconciling...'
                      : 'Reconcile plan'}
                  </Button>
                </div>

                <div className="mt-4 rounded-xl border border-border/60 bg-card/70 p-4">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between text-left"
                    onClick={() => setPlanRequest((c) => ({ ...c, _showBody: !(c as any)._showBody } as any))}
                  >
                    <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Request body</p>
                    <ChevronRight className={`size-3 text-muted-foreground transition-transform ${(planRequest as any)._showBody ? 'rotate-90' : ''}`} />
                  </button>
                  {(planRequest as any)._showBody ? (
                    <pre className="mt-3 overflow-x-auto text-xs leading-6 text-muted-foreground">
                      {JSON.stringify({ ...planRequest, siteId: planRequest.siteId.trim() || siteId, stationIds: planRequest.stationIds }, null, 2)}
                    </pre>
                  ) : null}
                </div>

                {planResponsePayload?.results?.length ? (
                  <div className="mt-4 rounded-xl border border-border/60 bg-card/70 p-4">
                    <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Apply results</p>
                    <div className="mt-3 space-y-3">
                      {planResponsePayload.results.map((result) => (
                        <div
                          key={result.stationId}
                          className="rounded-lg border border-border/50 bg-background/60 p-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-sm font-medium">
                              {result.stationId}
                            </div>
                            <Badge
                              variant={result.applied ? 'success' : 'secondary'}
                            >
                              {result.applied ? 'applied' : 'not applied'}
                            </Badge>
                          </div>
                          {result.reason ? (
                            <p className="mt-2 text-xs text-muted-foreground">
                              {result.reason}
                            </p>
                          ) : null}
                          <pre className="mt-3 overflow-x-auto text-xs leading-6 text-muted-foreground">
                            {JSON.stringify(result.payload ?? null, null, 2)}
                          </pre>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {planResponsePayload?.recommendations?.length ? (
                  <div className="mt-4 rounded-xl border border-border/60 bg-card/70 p-4">
                    <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">
                      Planned station limits
                    </p>
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-muted-foreground">
                            <th className="pr-3 pb-2">Station</th>
                            <th className="pr-3 pb-2">Eligible</th>
                            <th className="pr-3 pb-2">Charge limit</th>
                            <th className="pr-3 pb-2">Mode</th>
                            <th className="pr-3 pb-2">Export</th>
                            <th className="pr-3 pb-2">Discharge limit</th>
                          </tr>
                        </thead>
                        <tbody>
                          {planResponsePayload.recommendations.map((item) => (
                            <tr
                              key={item.stationId}
                              className="border-t border-border/40"
                            >
                              <td className="pr-3 py-2 font-medium">
                                {item.stationId}
                              </td>
                              <td className="pr-3 py-2">
                                {item.eligible ? 'yes' : 'no'}
                              </td>
                              <td className="pr-3 py-2">
                                {formatWatts(item.limitW)}
                              </td>
                              <td className="pr-3 py-2">
                                {item.operationMode ?? 'n/a'}
                              </td>
                              <td className="pr-3 py-2">
                                {item.exportAllowed ? 'enabled' : 'disabled'}
                              </td>
                              <td className="pr-3 py-2">
                                {formatWatts(item.dischargeLimitW ?? null)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}

                {planResponse ? (
                  <div className="mt-4 rounded-xl border border-border/60 bg-card/70 p-4">
                    <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">
                      Last response
                    </p>
                    <pre className="mt-3 overflow-x-auto text-xs leading-6 text-foreground">
                      {planResponse}
                    </pre>
                  </div>
                ) : null}
              </div>
            ) : null}

            {showOverview ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-card/70 p-4">
                <div className="space-y-1 text-sm">
                  <p className="font-medium">
                    {currentIntent?.source?.system ?? 'open-dynamic-export'}
                  </p>
                  <p className="text-muted-foreground">
                    Message {currentIntent?.messageId ?? 'n/a'} • Updated{' '}
                    {formatDateTime(
                      currentIntent?.updatedAt ??
                        currentIntent?.intentCreatedAt ??
                        null,
                    )}
                  </p>
                  <p className="text-muted-foreground">
                    Expires {formatDateTime(currentIntent?.expiresAt ?? null)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/${MenuSection.CHARGING_STATIONS}`}>
                      <RefreshCw className="size-4" />
                      Review stations
                    </Link>
                  </Button>
                  <Button asChild size="sm">
                    <Link href={`/${MenuSection.TRANSACTIONS}`}>
                      <ChevronRight className="size-4" />
                      Check transactions
                    </Link>
                  </Button>
                  {!showBuilder ? (
                    <Button asChild size="sm" variant="secondary">
                      <Link href={`/${MenuSection.EMS_PLAN_BUILDER}`}>
                        <Zap className="size-4" />
                        Open plan builder
                      </Link>
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
};
