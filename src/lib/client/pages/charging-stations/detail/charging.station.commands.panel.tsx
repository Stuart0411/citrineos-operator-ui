// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
'use client';

import type { ChargingStationDto } from '@citrineos/base';
import { ModalComponentType } from '@lib/client/components/modals/modal.types';
import { Button } from '@lib/client/components/ui/button';
import { ForceDisconnectButton } from '@lib/client/pages/charging-stations/force.disconnect.button';
import { ResetButton } from '@lib/client/pages/charging-stations/reset.button';
import { StartTransactionButton } from '@lib/client/pages/charging-stations/start.transaction.button';
import { StopTransactionButton } from '@lib/client/pages/charging-stations/stop.transaction.button';
import { buttonIconSize } from '@lib/client/styles/icon';
import { ActionType, ResourceType } from '@lib/utils/access.types';
import { openModal } from '@lib/utils/store/modal.slice';
import { CanAccess, useTranslate } from '@refinedev/core';
import { instanceToPlain } from 'class-transformer';
import { MoreHorizontal } from 'lucide-react';
import { useCallback } from 'react';
import { useDispatch } from 'react-redux';
import { CommandsUnavailableText } from '../commands.unavailable.text';

export const ChargingStationCommandsPanel = ({
  station,
}: {
  station: ChargingStationDto;
}) => {
  const dispatch = useDispatch();
  const translate = useTranslate();

  const showForceDisconnectModal = useCallback(() => {
    dispatch(
      openModal({
        title: translate('ChargingStations.forceDisconnect'),
        modalComponentType: ModalComponentType.forceDisconnect,
        modalComponentProps: { station: instanceToPlain(station) },
      }),
    );
  }, [dispatch, station, translate]);

  const showOtherCommandsModal = useCallback(() => {
    dispatch(
      openModal({
        title: translate('ChargingStations.otherCommands'),
        modalComponentType: ModalComponentType.otherCommands,
        modalComponentProps: { station: instanceToPlain(station) },
      }),
    );
  }, [dispatch, station, translate]);

  const hasActiveTransactions =
    Array.isArray((station as any).transactions) &&
    (station as any).transactions.length > 0;

  return (
    <CanAccess
      resource={ResourceType.CHARGING_STATIONS}
      action={ActionType.COMMAND}
      params={{ id: station.id }}
    >
      <div className="flex flex-col gap-2">
        {!station.isOnline && <CommandsUnavailableText />}
        <div className="flex gap-4 flex-wrap">
          <ForceDisconnectButton
            id={(station as any).pkId}
            onClickAction={showForceDisconnectModal}
          />
          {!hasActiveTransactions && (
            <StartTransactionButton station={station} disabled={!station.isOnline} />
          )}
          {hasActiveTransactions && (
            <StopTransactionButton station={station} disabled={!station.isOnline} />
          )}
          <ResetButton station={station} disabled={!station.isOnline} />
          <Button onClick={showOtherCommandsModal} disabled={!station.isOnline}>
            <MoreHorizontal className={buttonIconSize} />
            {translate('ChargingStations.otherCommands')}
          </Button>
        </div>
      </div>
    </CanAccess>
  );
};
