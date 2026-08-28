// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
'use client';

import { ChargingStationClass } from '@lib/cls/charging.station.dto';
import { CHARGING_STATIONS_GET_QUERY } from '@lib/queries/charging.stations';
import { ResourceType } from '@lib/utils/access.types';
import { getPlainToInstanceOptions } from '@lib/utils/tables';
import { useOne } from '@refinedev/core';
import { Skeleton } from '@lib/client/components/ui/skeleton';
import { NoDataFoundCard } from '@lib/client/components/no-data-found-card';
import { ChargingStationCommandsPanel } from './charging.station.commands.panel';

export const ChargingStationOperationsTab = ({ id }: { id: number }) => {
  const {
    query: { data, isLoading },
  } = useOne<any>({
    resource: ResourceType.CHARGING_STATIONS,
    id,
    meta: {
      gqlQuery: CHARGING_STATIONS_GET_QUERY,
    },
    queryOptions: getPlainToInstanceOptions(ChargingStationClass, true),
  });

  const station = data?.data;

  if (isLoading) {
    return <Skeleton className="h-24 w-full" />;
  }

  if (!station) {
    return <NoDataFoundCard message="Station not found." />;
  }

  return <ChargingStationCommandsPanel station={station} />;
};
