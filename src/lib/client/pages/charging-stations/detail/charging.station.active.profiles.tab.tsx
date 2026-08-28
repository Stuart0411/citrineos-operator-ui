// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
'use client';

import { HttpMethod, OCPPVersion } from '@citrineos/base';
import { Button } from '@lib/client/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@lib/client/components/ui/table';
import { TimestampDisplay } from '@lib/client/components/timestamp-display';
import { useTenantId } from '@lib/client/hooks/useTenantId';
import { GET_ACTIVE_CHARGING_PROFILES_FOR_STATION } from '@lib/queries/charging.profiles';
import { BaseRestClient } from '@lib/utils/BaseRestClient';
import { EMPTY_VALUE } from '@lib/utils/consts';
import {
  ocppResponseSuccessCheck,
  showError,
  showSuccess,
} from '@lib/utils/messages.utils';
import { useList } from '@refinedev/core';
import { useMemo, useState } from 'react';

type ChargingProfileRow = {
  databaseId: number;
  id: number;
  stationId: string;
  evseId?: number | null;
  stackLevel: number;
  chargingProfilePurpose: string;
  chargingProfileKind: string;
  chargingLimitSource?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  isActive: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
};

const fmt = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return EMPTY_VALUE;
  return String(value);
};

export const ChargingStationActiveProfilesTab = ({
  stationId,
  protocol,
}: {
  stationId?: string;
  protocol?: OCPPVersion | null;
}) => {
  const tenantId = useTenantId();
  const [clearingId, setClearingId] = useState<number | null>(null);
  const [isClearingAll, setIsClearingAll] = useState(false);

  const {
    query: { data, isLoading, refetch },
  } = useList<ChargingProfileRow>({
    resource: 'ChargingProfiles',
    meta: {
      gqlQuery: GET_ACTIVE_CHARGING_PROFILES_FOR_STATION,
      gqlVariables: {
        stationId,
      },
    },
    sorters: [{ field: 'updatedAt', order: 'desc' }],
    queryOptions: {
      enabled: Boolean(stationId),
    },
    pagination: {
      mode: 'off',
    },
  });

  const rows = useMemo(() => data?.data ?? [], [data?.data]);
  const clearableRows = rows.filter((row) => Number.isInteger(row.id));

  const clearProfileById = async (profileId: number): Promise<boolean> => {
    if (!stationId) {
      showError('Station identifier is missing.');
      return false;
    }

    try {
      setClearingId(profileId);
      const client = new BaseRestClient(protocol ?? OCPPVersion.OCPP2_0_1);
      const response = await client.postRaw<any>(
        `/smartcharging/clearChargingProfile?identifier=${stationId}&tenantId=${tenantId}`,
        { chargingProfileId: profileId },
        {
          method: HttpMethod.Post,
        },
      );

      const ok = ocppResponseSuccessCheck(response.data);
      if (!ok) {
        showError(`Failed to clear charging profile ${profileId}.`);
        return false;
      }

      showSuccess({ chargingProfileId: profileId });
      await refetch();
      return true;
    } catch (error: any) {
      showError(
        `Failed to clear charging profile ${profileId}: ${error?.message ?? 'Unknown error'}`,
      );
      return false;
    } finally {
      setClearingId(null);
    }
  };

  const clearAllProfiles = async () => {
    if (clearableRows.length === 0) {
      return;
    }

    setIsClearingAll(true);
    let successCount = 0;
    for (const row of clearableRows) {
      const profileId = Number(row.id);
      const cleared = await clearProfileById(profileId);
      if (cleared) {
        successCount += 1;
      }
    }
    setIsClearingAll(false);

    if (successCount === clearableRows.length) {
      showSuccess(`Cleared ${successCount} active charging profile(s).`);
    } else {
      showError(
        `Cleared ${successCount} of ${clearableRows.length} active charging profile(s).`,
      );
    }
  };

  if (!stationId) {
    return (
      <p className="text-sm text-muted-foreground">
        Station identifier is unavailable.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Active charging profiles reported for this station.
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={isLoading || isClearingAll || clearableRows.length === 0}
          onClick={() => void clearAllProfiles()}
        >
          {isClearingAll ? 'Clearing...' : 'Clear all active'}
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Profile ID</TableHead>
              <TableHead>Purpose</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>Limit Source</TableHead>
              <TableHead>Stack</TableHead>
              <TableHead>EVSE</TableHead>
              <TableHead>Valid From</TableHead>
              <TableHead>Valid To</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={10} className="text-sm text-muted-foreground">
                  Loading active charging profiles...
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="text-sm text-muted-foreground">
                  No active charging profiles found.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const rowProfileId = Number(row.id);
                const canClear = Number.isInteger(rowProfileId);
                const isClearingRow = clearingId === rowProfileId;

                return (
                  <TableRow key={row.databaseId}>
                    <TableCell>{fmt(row.id)}</TableCell>
                    <TableCell>{fmt(row.chargingProfilePurpose)}</TableCell>
                    <TableCell>{fmt(row.chargingProfileKind)}</TableCell>
                    <TableCell>{fmt(row.chargingLimitSource)}</TableCell>
                    <TableCell>{fmt(row.stackLevel)}</TableCell>
                    <TableCell>{fmt(row.evseId)}</TableCell>
                    <TableCell>
                      {row.validFrom ? (
                        <TimestampDisplay isoTimestamp={row.validFrom} />
                      ) : (
                        EMPTY_VALUE
                      )}
                    </TableCell>
                    <TableCell>
                      {row.validTo ? (
                        <TimestampDisplay isoTimestamp={row.validTo} />
                      ) : (
                        EMPTY_VALUE
                      )}
                    </TableCell>
                    <TableCell>
                      {row.updatedAt ? (
                        <TimestampDisplay isoTimestamp={row.updatedAt} />
                      ) : (
                        EMPTY_VALUE
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!canClear || isClearingRow || isClearingAll}
                        onClick={() => canClear && void clearProfileById(rowProfileId)}
                      >
                        {isClearingRow ? 'Clearing...' : 'Clear'}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};
