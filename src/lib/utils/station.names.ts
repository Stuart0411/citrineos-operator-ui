// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

type StationLike = {
  id?: number | string | null;
  ocppConnectionName?: string | null;
};

type TransactionLike = {
  id?: number | string | null;
  stationId?: number | string | null;
  ocppConnectionName?: string | null;
  chargingStation?: StationLike | null;
};

export const getStationDisplayName = (station?: StationLike | null): string => {
  const ocppConnectionName = station?.ocppConnectionName?.trim();
  if (ocppConnectionName) {
    return ocppConnectionName;
  }

  if (station?.id == null) {
    return 'n/a';
  }

  return String(station.id);
};

export const getTransactionStationDisplayName = (
  transaction?: TransactionLike | null,
): string => {
  if (transaction?.chargingStation) {
    return getStationDisplayName(transaction.chargingStation);
  }

  const ocppConnectionName = transaction?.ocppConnectionName?.trim();
  if (ocppConnectionName) {
    return ocppConnectionName;
  }

  if (transaction?.stationId != null) {
    return String(transaction.stationId);
  }

  if (transaction?.id != null) {
    return String(transaction.id);
  }

  return 'n/a';
};
