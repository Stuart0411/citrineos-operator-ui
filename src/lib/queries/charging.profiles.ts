// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import { gql } from 'graphql-tag';

export const GET_ACTIVE_CHARGING_PROFILES_FOR_STATION = gql`
  query GetActiveChargingProfilesForStation(
    $stationId: String!
    $where: [ChargingProfiles_bool_exp!] = []
    $order_by: [ChargingProfiles_order_by!] = {}
    $offset: Int
    $limit: Int
  ) {
    ChargingProfiles(
      where: {
        stationId: { _eq: $stationId }
        isActive: { _eq: true }
        _and: $where
      }
      order_by: $order_by
      offset: $offset
      limit: $limit
    ) {
      databaseId
      id
      stationId
      evseId
      stackLevel
      chargingProfilePurpose
      chargingProfileKind
      chargingLimitSource
      validFrom
      validTo
      isActive
      createdAt
      updatedAt
    }
    ChargingProfiles_aggregate(
      where: {
        stationId: { _eq: $stationId }
        isActive: { _eq: true }
        _and: $where
      }
    ) {
      aggregate {
        count
      }
    }
  }
`;
