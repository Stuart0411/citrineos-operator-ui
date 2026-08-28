// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
'use client';

import type { ChargingStationDto, OCPPMessageDto } from '@citrineos/base';
import { HttpMethod, OCPPVersion } from '@citrineos/base';
import { Button } from '@lib/client/components/ui/button';
import { Input } from '@lib/client/components/ui/input';
import { Label } from '@lib/client/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@lib/client/components/ui/select';
import { TimestampDisplay } from '@lib/client/components/timestamp-display';
import { useTenantId } from '@lib/client/hooks/useTenantId';
import { GET_ACTIVE_CHARGING_PROFILES_FOR_STATION } from '@lib/queries/charging.profiles';
import { GET_OCPP_MESSAGES_LIST_FOR_STATION } from '@lib/queries/ocpp.messages';
import { BaseRestClient } from '@lib/utils/BaseRestClient';
import { ResourceType } from '@lib/utils/access.types';
import {
  ocppResponseSuccessCheck,
  showError,
  showSuccess,
} from '@lib/utils/messages.utils';
import { useList } from '@refinedev/core';
import { useEffect, useMemo, useState } from 'react';

type ControlMode = 'dynamicUpdate' | 'setProfile';

type ProfileKind = 'Dynamic' | 'Absolute';

type ProfilePurpose =
  | 'ChargingStationExternalConstraints'
  | 'ChargingStationMaxProfile'
  | 'TxDefaultProfile'
  | 'TxProfile';

type OperationMode =
  | 'ExternalLimits'
  | 'ChargingOnly'
  | 'CentralSetpoint'
  | 'ExternalSetpoint'
  | 'LocalFrequency'
  | 'LocalLoadBalancing'
  | 'Idle';

type ChargingProfileRow = {
  id: number;
  chargingProfileKind: string;
  chargingProfilePurpose: string;
  updatedAt?: string | null;
};

type TelemetrySnapshot = {
  socPercent?: number;
  chargingRateKw?: number;
  observedAt?: string;
  sourceAction?: string;
};

const OPERATION_MODES: OperationMode[] = [
  'ExternalLimits',
  'ChargingOnly',
  'CentralSetpoint',
  'ExternalSetpoint',
  'LocalFrequency',
  'LocalLoadBalancing',
  'Idle',
];

const PROFILE_PURPOSES: ProfilePurpose[] = [
  'ChargingStationExternalConstraints',
  'ChargingStationMaxProfile',
  'TxDefaultProfile',
  'TxProfile',
];

const parseOptionalNumber = (value: string): number | undefined => {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const normalizePowerToKw = (value: number, unit?: string): number => {
  const normalizedUnit = (unit ?? '').trim().toLowerCase();
  if (normalizedUnit === 'kw') return value;
  if (normalizedUnit === 'w') return value / 1000;
  if (normalizedUnit === 'mw') return value * 1000;
  return value;
};

const extractPayload = (rawMessage: unknown): any => {
  if (Array.isArray(rawMessage)) {
    const messageTypeId = rawMessage[0];
    if (messageTypeId === 2) {
      return rawMessage[3];
    }
    if (messageTypeId === 3) {
      return rawMessage[2];
    }
    if (messageTypeId === 4) {
      return {
        errorCode: rawMessage[2],
        errorDescription: rawMessage[3],
        errorDetails: rawMessage[4],
      };
    }
  }
  return rawMessage;
};

const collectSampledValues = (payload: any): Array<Record<string, any>> => {
  const meterValueSources: any[] = [];

  if (Array.isArray(payload?.meterValue)) {
    meterValueSources.push(...payload.meterValue);
  }

  if (Array.isArray(payload?.transactionData)) {
    for (const transactionData of payload.transactionData) {
      if (Array.isArray(transactionData?.meterValue)) {
        meterValueSources.push(...transactionData.meterValue);
      }
    }
  }

  if (Array.isArray(payload?.evse?.meterValue)) {
    meterValueSources.push(...payload.evse.meterValue);
  }

  const samples: Array<Record<string, any>> = [];
  for (const meterValue of meterValueSources) {
    if (Array.isArray(meterValue?.sampledValue)) {
      samples.push(...meterValue.sampledValue);
    }
  }
  return samples;
};

const extractTelemetrySnapshot = (rows: Array<Pick<OCPPMessageDto, 'message' | 'timestamp' | 'action'>>): TelemetrySnapshot => {
  const snapshot: TelemetrySnapshot = {};

  for (const row of rows) {
    const payload = extractPayload(row.message);
    const sampledValues = collectSampledValues(payload);

    if (sampledValues.length === 0) {
      continue;
    }

    if (snapshot.socPercent === undefined) {
      const socSample = sampledValues.find((sample) => {
        const measurand = String(sample?.measurand ?? '').toLowerCase();
        return measurand === 'soc' || measurand.includes('soc');
      });
      const socValue = Number(socSample?.value);
      if (Number.isFinite(socValue)) {
        snapshot.socPercent = socValue;
        snapshot.observedAt = row.timestamp;
        snapshot.sourceAction = row.action;
      }
    }

    if (snapshot.chargingRateKw === undefined) {
      const powerSample = sampledValues.find((sample) => {
        const measurand = String(sample?.measurand ?? '').toLowerCase();
        return (
          measurand === 'power.active.import' ||
          measurand === 'power.active.export' ||
          measurand.startsWith('power.active') ||
          measurand.startsWith('power')
        );
      });
      const powerValue = Number(powerSample?.value);
      if (Number.isFinite(powerValue)) {
        snapshot.chargingRateKw = normalizePowerToKw(powerValue, powerSample?.unit);
        if (!snapshot.observedAt) {
          snapshot.observedAt = row.timestamp;
          snapshot.sourceAction = row.action;
        }
      }
    }

    if (snapshot.socPercent !== undefined && snapshot.chargingRateKw !== undefined) {
      break;
    }
  }

  return snapshot;
};

const generateProfileId = (): number => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Number.isInteger(nowSeconds) && nowSeconds > 0 && nowSeconds <= 2147483647) {
    return nowSeconds;
  }
  return Math.floor(Math.random() * 1000000000) + 1;
};

export const ChargingStationSmartChargingPanel = ({
  station,
}: {
  station: ChargingStationDto;
}) => {
  const tenantId = useTenantId();
  const stationIdentifier = station.id ? String(station.id) : undefined;
  const isOcpp21 = station.protocol === OCPPVersion.OCPP2_1;

  const evseOptions = useMemo(() => {
    const source = Array.isArray((station as any).evses) ? (station as any).evses : [];
    const values: number[] = source.reduce((result: number[], evse: any) => {
      const candidate = Number(evse?.evseTypeId ?? evse?.evseId);
      if (Number.isInteger(candidate) && candidate >= 0) {
        result.push(candidate);
      }
      return result;
    }, []);
    return Array.from(new Set<number>(values));
  }, [station]);

  const [controlMode, setControlMode] = useState<ControlMode>('dynamicUpdate');
  const [profileKind, setProfileKind] = useState<ProfileKind>('Dynamic');
  const [profilePurpose, setProfilePurpose] =
    useState<ProfilePurpose>('ChargingStationExternalConstraints');
  const [operationMode, setOperationMode] = useState<OperationMode>('ExternalLimits');
  const [selectedEvseId, setSelectedEvseId] = useState<string>(
    String(evseOptions[0] ?? 1),
  );
  const [dynamicProfileId, setDynamicProfileId] = useState('');
  const [profileIdInput, setProfileIdInput] = useState('');
  const [stackLevelInput, setStackLevelInput] = useState('0');
  const [transactionIdInput, setTransactionIdInput] = useState('');
  const [startScheduleInput, setStartScheduleInput] = useState('');
  const [limitInput, setLimitInput] = useState('');
  const [setpointInput, setSetpointInput] = useState('');
  const [dischargeLimitInput, setDischargeLimitInput] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const {
    query: { data: profilesData, isLoading: profilesLoading, refetch: refetchProfiles },
  } = useList<ChargingProfileRow>({
    resource: 'ChargingProfiles',
    meta: {
      gqlQuery: GET_ACTIVE_CHARGING_PROFILES_FOR_STATION,
      gqlVariables: {
        stationId: stationIdentifier,
      },
    },
    sorters: [{ field: 'updatedAt', order: 'desc' }],
    queryOptions: {
      enabled: Boolean(stationIdentifier),
    },
    pagination: {
      mode: 'off',
    },
  });

  const dynamicProfiles = useMemo(
    () =>
      (profilesData?.data ?? []).filter(
        (profile) => profile.chargingProfileKind === 'Dynamic',
      ),
    [profilesData?.data],
  );

  useEffect(() => {
    if (!dynamicProfileId && dynamicProfiles.length > 0) {
      setDynamicProfileId(String(dynamicProfiles[0].id));
    }
  }, [dynamicProfileId, dynamicProfiles]);

  useEffect(() => {
    if (evseOptions.length > 0 && !evseOptions.includes(Number(selectedEvseId))) {
      setSelectedEvseId(String(evseOptions[0]));
    }
  }, [evseOptions, selectedEvseId]);

  const {
    query: { data: logsData, isLoading: logsLoading },
  } = useList<OCPPMessageDto>({
    resource: ResourceType.OCPP_MESSAGES,
    pagination: {
      currentPage: 1,
      pageSize: 40,
    },
    sorters: [{ field: 'timestamp', order: 'desc' }],
    meta: {
      gqlQuery: GET_OCPP_MESSAGES_LIST_FOR_STATION,
      gqlVariables: {
        stationId: stationIdentifier,
      },
    },
    filters: [
      {
        field: 'action',
        operator: 'in',
        value: ['TransactionEvent', 'MeterValues'],
      },
    ],
    queryOptions: {
      enabled: Boolean(stationIdentifier),
    },
  });

  const latestTelemetry = useMemo(
    () => extractTelemetrySnapshot(logsData?.data ?? []),
    [logsData?.data],
  );

  const setpointRequired =
    operationMode === 'CentralSetpoint' || operationMode === 'ExternalSetpoint';
  const limitOrDischargeRequired = operationMode === 'ExternalLimits';

  const buildPeriod = (): Record<string, number | string> => {
    const limit = parseOptionalNumber(limitInput);
    const setpoint = parseOptionalNumber(setpointInput);
    const dischargeLimit = parseOptionalNumber(dischargeLimitInput);

    if (setpointRequired && setpoint === undefined) {
      throw new Error('Setpoint is required for the selected operation mode.');
    }

    if (limitOrDischargeRequired && limit === undefined && dischargeLimit === undefined) {
      throw new Error('Provide at least a limit or discharge limit for ExternalLimits mode.');
    }

    const period: Record<string, number | string> = {
      startPeriod: 0,
      operationMode,
    };

    if (limit !== undefined) {
      period.limit = limit;
    }
    if (setpoint !== undefined) {
      period.setpoint = setpoint;
    }
    if (dischargeLimit !== undefined) {
      period.dischargeLimit = dischargeLimit;
    }

    if (Object.keys(period).length <= 2) {
      throw new Error('Provide at least one control value (limit, setpoint, or discharge limit).');
    }

    return period;
  };

  const submitControl = async () => {
    if (!stationIdentifier) {
      showError('Station identifier is missing.');
      return;
    }

    if (!isOcpp21) {
      showError('This control panel currently supports OCPP 2.1 stations only.');
      return;
    }

    const evseId = Number(selectedEvseId);
    if (!Number.isInteger(evseId) || evseId < 0) {
      showError('EVSE ID must be a non-negative integer.');
      return;
    }

    setSubmitting(true);

    try {
      const period = buildPeriod();
      const client = new BaseRestClient(OCPPVersion.OCPP2_1);

      if (controlMode === 'dynamicUpdate') {
        const fallbackDynamicId = dynamicProfiles[0]?.id;
        const profileId = Number(dynamicProfileId || fallbackDynamicId);
        if (!Number.isInteger(profileId) || profileId <= 0) {
          throw new Error('Select a valid active Dynamic profile ID to update.');
        }

        const { startPeriod, ...scheduleUpdate } = period;
        void startPeriod;

        const response = await client.postRaw<any>(
          `/smartcharging/updateDynamicSchedule?identifier=${stationIdentifier}&tenantId=${tenantId}`,
          {
            chargingProfileId: profileId,
            scheduleUpdate,
          },
          { method: HttpMethod.Post },
        );

        if (!ocppResponseSuccessCheck(response.data)) {
          throw new Error('Charging station rejected UpdateDynamicSchedule request.');
        }

        showSuccess(`Updated dynamic profile ${profileId}.`);
        await refetchProfiles();
        return;
      }

      const generatedProfileId = parseOptionalNumber(profileIdInput) ?? generateProfileId();
      const stackLevel = parseOptionalNumber(stackLevelInput) ?? 0;
      if (!Number.isInteger(generatedProfileId) || generatedProfileId <= 0) {
        throw new Error('Profile ID must be a positive integer.');
      }
      if (!Number.isInteger(stackLevel) || stackLevel < 0) {
        throw new Error('Stack level must be zero or greater.');
      }
      if (profilePurpose === 'TxProfile' && !transactionIdInput.trim()) {
        throw new Error('Transaction ID is required when purpose is TxProfile.');
      }

      const startSchedule =
        profileKind === 'Absolute'
          ? startScheduleInput.trim() || new Date().toISOString()
          : undefined;

      const setResponse = await client.postRaw<any>(
        `/smartcharging/setChargingProfile?identifier=${stationIdentifier}&tenantId=${tenantId}`,
        {
          evseId,
          chargingProfile: {
            id: generatedProfileId,
            stackLevel,
            chargingProfilePurpose: profilePurpose,
            chargingProfileKind: profileKind,
            ...(profilePurpose === 'TxProfile'
              ? { transactionId: transactionIdInput.trim() }
              : {}),
            chargingSchedule: [
              {
                id: 1,
                chargingRateUnit: 'W',
                ...(startSchedule ? { startSchedule } : {}),
                chargingSchedulePeriod: [period],
              },
            ],
          },
        },
        { method: HttpMethod.Post },
      );

      if (!ocppResponseSuccessCheck(setResponse.data)) {
        throw new Error('Charging station rejected SetChargingProfile request.');
      }

      if (profileKind === 'Dynamic') {
        setDynamicProfileId(String(generatedProfileId));
      }

      showSuccess(`Applied ${profileKind} profile ${generatedProfileId}.`);
      await refetchProfiles();
    } catch (error: any) {
      showError(error?.message ?? 'Failed to dispatch smart charging command.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 rounded-lg border border-border/60 bg-card/40 p-4">
      <div>
        <h3 className="text-sm font-semibold">Smart Charging Control Panel</h3>
        <p className="text-xs text-muted-foreground">
          Guided controls for setpoints and limits with context-aware fields.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-md border bg-background/70 p-3">
          <p className="text-xs text-muted-foreground">Vehicle SoC</p>
          <p className="text-xl font-semibold">
            {latestTelemetry.socPercent !== undefined
              ? `${latestTelemetry.socPercent.toFixed(1)}%`
              : '--'}
          </p>
        </div>
        <div className="rounded-md border bg-background/70 p-3">
          <p className="text-xs text-muted-foreground">Charging Rate</p>
          <p className="text-xl font-semibold">
            {latestTelemetry.chargingRateKw !== undefined
              ? `${latestTelemetry.chargingRateKw.toFixed(2)} kW`
              : '--'}
          </p>
        </div>
        <div className="rounded-md border bg-background/70 p-3">
          <p className="text-xs text-muted-foreground">Latest Telemetry</p>
          <p className="text-sm font-medium">
            {latestTelemetry.observedAt ? (
              <TimestampDisplay isoTimestamp={latestTelemetry.observedAt} />
            ) : (
              '--'
            )}
          </p>
          {latestTelemetry.sourceAction ? (
            <p className="text-xs text-muted-foreground mt-1">
              Source: {latestTelemetry.sourceAction}
            </p>
          ) : null}
        </div>
      </div>

      {!isOcpp21 ? (
        <p className="text-sm text-muted-foreground">
          Smart control builder is currently enabled for OCPP 2.1 stations.
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>Control Mode</Label>
          <Select
            value={controlMode}
            onValueChange={(value) => setControlMode(value as ControlMode)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="dynamicUpdate">Update active Dynamic profile</SelectItem>
              <SelectItem value="setProfile">Create and apply profile</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>EVSE</Label>
          {evseOptions.length > 0 ? (
            <Select value={selectedEvseId} onValueChange={setSelectedEvseId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {evseOptions.map((evseId) => (
                  <SelectItem key={String(evseId)} value={String(evseId)}>
                    EVSE {evseId}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              value={selectedEvseId}
              type="number"
              min={0}
              onChange={(event) => setSelectedEvseId(event.target.value)}
            />
          )}
        </div>

        <div className="space-y-2">
          <Label>Operation Mode</Label>
          <Select
            value={operationMode}
            onValueChange={(value) => setOperationMode(value as OperationMode)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OPERATION_MODES.map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {mode}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Profile Purpose</Label>
          <Select
            value={profilePurpose}
            onValueChange={(value) => setProfilePurpose(value as ProfilePurpose)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROFILE_PURPOSES.map((purpose) => (
                <SelectItem key={purpose} value={purpose}>
                  {purpose}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {controlMode === 'dynamicUpdate' ? (
          <div className="space-y-2 md:col-span-2">
            <Label>Dynamic Profile ID</Label>
            <div className="flex gap-2">
              <Input
                value={dynamicProfileId}
                type="number"
                min={1}
                onChange={(event) => setDynamicProfileId(event.target.value)}
                placeholder="Select active Dynamic profile"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const fallback = dynamicProfiles[0]?.id;
                  if (fallback) {
                    setDynamicProfileId(String(fallback));
                  }
                }}
                disabled={profilesLoading || dynamicProfiles.length === 0}
              >
                Use latest
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {dynamicProfiles.length > 0
                ? `Detected ${dynamicProfiles.length} active Dynamic profile(s).`
                : 'No active Dynamic profiles found for this station.'}
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <Label>Profile Kind</Label>
              <Select
                value={profileKind}
                onValueChange={(value) => setProfileKind(value as ProfileKind)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Dynamic">Dynamic</SelectItem>
                  <SelectItem value="Absolute">Absolute</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Profile ID</Label>
              <Input
                value={profileIdInput}
                type="number"
                min={1}
                onChange={(event) => setProfileIdInput(event.target.value)}
                placeholder="Auto-generate if empty"
              />
            </div>

            <div className="space-y-2">
              <Label>Stack Level</Label>
              <Input
                value={stackLevelInput}
                type="number"
                min={0}
                onChange={(event) => setStackLevelInput(event.target.value)}
              />
            </div>

            {profilePurpose === 'TxProfile' ? (
              <div className="space-y-2">
                <Label>Transaction ID</Label>
                <Input
                  value={transactionIdInput}
                  onChange={(event) => setTransactionIdInput(event.target.value)}
                  placeholder="Required for TxProfile"
                />
              </div>
            ) : null}

            {profileKind === 'Absolute' ? (
              <div className="space-y-2 md:col-span-2">
                <Label>Start Schedule (ISO date-time)</Label>
                <Input
                  value={startScheduleInput}
                  onChange={(event) => setStartScheduleInput(event.target.value)}
                  placeholder="Leave blank to use current time"
                />
              </div>
            ) : null}
          </>
        )}

        <div className="space-y-2">
          <Label>
            Limit (W)
            {limitOrDischargeRequired ? ' (required if discharge empty)' : ''}
          </Label>
          <Input
            value={limitInput}
            type="number"
            step="0.1"
            onChange={(event) => setLimitInput(event.target.value)}
            placeholder="e.g. 7000"
          />
        </div>

        {(setpointRequired || operationMode === 'ExternalLimits') ? (
          <div className="space-y-2">
            <Label>
              Setpoint (W)
              {setpointRequired ? ' (required)' : ''}
            </Label>
            <Input
              value={setpointInput}
              type="number"
              step="0.1"
              onChange={(event) => setSetpointInput(event.target.value)}
              placeholder="e.g. 4500"
            />
          </div>
        ) : null}

        {operationMode === 'ExternalLimits' ? (
          <div className="space-y-2">
            <Label>Discharge Limit (W, negative)</Label>
            <Input
              value={dischargeLimitInput}
              type="number"
              step="0.1"
              onChange={(event) => setDischargeLimitInput(event.target.value)}
              placeholder="e.g. -3000"
            />
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {logsLoading
            ? 'Loading latest telemetry from OCPP logs...'
            : 'Telemetry values are parsed from the most recent TransactionEvent and MeterValues logs.'}
        </p>
        <Button onClick={() => void submitControl()} disabled={submitting || !isOcpp21}>
          {submitting ? 'Sending...' : 'Send control command'}
        </Button>
      </div>
    </div>
  );
};
