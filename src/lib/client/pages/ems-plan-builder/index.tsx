// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
'use client';

import { EmsOperationsCard } from '@lib/client/pages/overview/ems-operations/ems.operations.card';
import config from '@lib/utils/config';

export const EmsPlanBuilderPage = () => {
  if (!config.emsEnabled) {
    return null;
  }

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <EmsOperationsCard showOverview={false} />
    </div>
  );
};
