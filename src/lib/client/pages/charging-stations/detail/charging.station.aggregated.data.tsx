// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
'use client';

import {
  type MeterValueDto,
  OCPP2_0_1,
  type TransactionEventDto,
} from '@citrineos/base';
import { RangePicker } from '@lib/client/components/range-picker';
import { LoadingIcon } from '@lib/client/components/ui/loading';
import { TransactionEventClass } from '@lib/cls/transaction.event.dto';
import { GET_TRANSACTION_EVENTS_WITH_METER_VALUES_BY_STATION_ID } from '@lib/queries/transaction.events';
import { ResourceType } from '@lib/utils/access.types';
import { getPlainToInstanceOptions } from '@lib/utils/tables';
import { useList } from '@refinedev/core';
import {
  endOfDay,
  isAfter,
  isBefore,
  isSameDay,
  parseISO,
  startOfDay,
  subDays,
} from 'date-fns';
import type { FC } from 'react';
import { useMemo, useState } from 'react';
import { type DateRange } from 'react-day-picker';
import { ChartsWrapper } from '@lib/client/pages/transactions/chart/charts.wrapper';
import { MultiSelect } from '@lib/client/components/multi-select';
import { pageFlex } from '@lib/client/styles/page';

const allContexts = Object.values(OCPP2_0_1.ReadingContextEnumType);

const filterByDate = (
  series: MeterValueDto[],
  range: DateRange | undefined,
) => {
  if (!range?.from || !range?.to) return series;

  return series.filter((mv) => {
    const ts = parseISO(mv.timestamp);
    const isAfterOrSameStart =
      isAfter(ts, range.from!) || isSameDay(ts, range.from!);
    const isBeforeOrSameEnd =
      isBefore(ts, range.to!) || isSameDay(ts, range.to!);
    return isAfterOrSameStart && isBeforeOrSameEnd;
  });
};

export const AggregatedMeterValuesData: FC<{ stationId?: string }> = ({
  stationId,
}) => {
  const defaultRange: DateRange = {
    from: startOfDay(subDays(new Date(), 7)),
    to: endOfDay(new Date()),
  };
  const [dateRange, setDateRange] = useState(defaultRange);
  const [validContexts, setValidContexts] =
    useState<OCPP2_0_1.ReadingContextEnumType[]>(allContexts);

  const transactionEventWhere = useMemo(() => {
    if (!dateRange.from || !dateRange.to) {
      return {};
    }

    return {
      timestamp: {
        _gte: dateRange.from.toISOString(),
        _lte: dateRange.to.toISOString(),
      },
    };
  }, [dateRange.from, dateRange.to]);

  const {
    query: { data: teData, isLoading: teLoading, error: teError },
  } = useList<TransactionEventDto>({
    resource: ResourceType.TRANSACTION_EVENTS,
    meta: {
      gqlQuery: GET_TRANSACTION_EVENTS_WITH_METER_VALUES_BY_STATION_ID,
      gqlVariables: {
        stationId,
        where: transactionEventWhere,
        order_by: { timestamp: 'desc' },
        limit: 50000,
        offset: 0,
      },
    },
    queryOptions: {
      ...getPlainToInstanceOptions(TransactionEventClass),
      enabled: Boolean(stationId),
    },
  });

  const meterValues = useMemo<MeterValueDto[]>(() => {
    const flattened: MeterValueDto[] = [];
    for (const eventRow of teData?.data ?? []) {
      const nestedMeterValues =
        ((eventRow as any)?.MeterValues as MeterValueDto[] | undefined) ??
        ((eventRow as any)?.meterValues as MeterValueDto[] | undefined) ??
        [];

      flattened.push(...nestedMeterValues);
    }

    return flattened.sort(
      (left, right) =>
        new Date(left.timestamp).getTime() -
        new Date(right.timestamp).getTime(),
    );
  }, [teData?.data]);

  if (teLoading)
    return (
      <div className="flex justify-center p-8">
        <LoadingIcon />
      </div>
    );

  if (teError) {
    return (
      <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive">
        Failed to load aggregated meter values.
      </div>
    );
  }

  const data = filterByDate(meterValues, dateRange);

  return (
    <div className={pageFlex}>
      <div className="grid grid-cols-3 gap-4 w-full">
        <div className="flex flex-col gap-2">
          <label className="text-sm font-semibold">Time Range:</label>
          <RangePicker dateRange={dateRange} setDateRange={setDateRange} />
        </div>
        <div className="col-span-2 flex flex-col gap-2">
          <label className="text-sm font-semibold">Contexts:</label>
          <MultiSelect<OCPP2_0_1.ReadingContextEnumType>
            options={Object.values(OCPP2_0_1.ReadingContextEnumType)}
            selectedValues={validContexts}
            setSelectedValues={setValidContexts}
            placeholder="Select reading contexts"
          />
        </div>
      </div>

      <ChartsWrapper meterValues={data} validContexts={validContexts} />
    </div>
  );
};
