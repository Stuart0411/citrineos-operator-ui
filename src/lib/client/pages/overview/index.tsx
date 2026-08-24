// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
'use client';

import { MenuSection } from '@lib/client/components/main-menu/main.menu';
import { Badge } from '@lib/client/components/ui/badge';
import { Button } from '@lib/client/components/ui/button';
import { Card, CardContent, CardDescription, CardTitle } from '@lib/client/components/ui/card';
import { ActiveTransactionsCard } from '@lib/client/pages/overview/active-transactions/active.transactions.card';
import { ChargerActivityCard } from '@lib/client/pages/overview/charger-activity/charger.activity.card';
import { EmsOperationsCard } from '@lib/client/pages/overview/ems-operations/ems.operations.card';
import { LocationsCard } from '@lib/client/pages/overview/locations/locations.card';
import { OnlineStatusCard } from '@lib/client/pages/overview/online-status/online.status.card';
import { PluginSuccessRateCard } from '@lib/client/pages/overview/plugin-success-rate/plugin.success.rate.card';
import { Activity, ArrowUpRight, Bolt, Layers3 } from 'lucide-react';
import Link from 'next/link';

export const Overview = () => {
  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <Card className="overflow-hidden border-border/60 bg-gradient-to-br from-background via-background to-primary/5 shadow-sm">
        <CardContent className="grid gap-6 p-6 lg:grid-cols-[1.35fr_0.9fr] lg:items-center">
          <div className="space-y-4">
            <Badge variant="secondary" className="w-fit uppercase tracking-[0.3em]">
              Live operations
            </Badge>
            <div className="space-y-2">
              <CardTitle className="text-3xl font-semibold tracking-tight md:text-4xl">
                CitrineOS command center
              </CardTitle>
              <CardDescription className="max-w-2xl text-base leading-7">
                Monitor charger availability, EMS site intent, and charging-plan activity from
                one place. The current runtime is wired for live ODE intake and OCPP 2.1
                dispatch validation.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild>
                <Link href={`/${MenuSection.CHARGING_STATIONS}`}>
                  <Bolt className="size-4" />
                  Charging stations
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href={`/${MenuSection.TRANSACTIONS}`}>
                  <Activity className="size-4" />
                  Transactions
                </Link>
              </Button>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
            <div className="rounded-xl border border-border/70 bg-card/70 p-4 shadow-xs backdrop-blur-sm">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Layers3 className="size-4 text-primary" />
                Runtime focus
              </div>
              <p className="mt-3 text-lg font-semibold">Live EMS and charger telemetry</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Surface site intent, dispatch, and drift in a single operational view.
              </p>
            </div>
            <div className="rounded-xl border border-border/70 bg-card/70 p-4 shadow-xs backdrop-blur-sm">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Bolt className="size-4 text-primary" />
                Dispatch readiness
              </div>
              <p className="mt-3 text-lg font-semibold">CSMS-side apply confirmed</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Eligibility checks are relaxed for OCPP 2.1 stations so live plans can be tested.
              </p>
            </div>
            <div className="rounded-xl border border-border/70 bg-card/70 p-4 shadow-xs backdrop-blur-sm">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <ArrowUpRight className="size-4 text-primary" />
                Live feedback
              </div>
              <p className="mt-3 text-lg font-semibold">Plan derive, apply, reconcile</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Open the dedicated EMS plan builder page for derive, apply, and reconcile flows.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <OnlineStatusCard />
        <ChargerActivityCard />
        <PluginSuccessRateCard />
      </div>
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-12">
        <div className="w-full xl:col-span-4">
          <EmsOperationsCard showBuilder={false} />
        </div>
        <div className="w-full xl:col-span-4">
          <LocationsCard />
        </div>
        <div className="w-full xl:col-span-4">
          <ActiveTransactionsCard />
        </div>
      </div>
    </div>
  );
};
