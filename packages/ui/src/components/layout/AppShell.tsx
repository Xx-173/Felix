import React from 'react';
import { TitleBar } from './TitleBar';
import { WorkspaceBridge } from '../kernel/WorkspaceBridge';
import { WebAccountPanel } from '../profile/WebAccountPanel';
import { KernelBridge } from '../kernel/KernelBridge';
import { WorkbenchShell } from './WorkbenchShell';
import { OnboardingOverlay } from '../onboarding/OnboardingOverlay';
import { CommandPalette } from '../command/CommandPalette';
import { ThemeProvider } from './ThemeProvider';
import { TooltipProvider } from '../ui/tooltip';
import { Toaster } from 'sonner';
import {
  FinagentClientProvider,
  fallbackClient,
  type FinagentClient,
} from '../../client';
import { I18nProvider } from '../../i18n/I18nProvider';
import { LongBridgeBanner } from './LongBridgeBanner';

interface AppShellProps {
  client?: FinagentClient;
}

export const AppShell: React.FC<AppShellProps> = ({ client = fallbackClient }) => {
  return (
    <FinagentClientProvider client={client}>
      <I18nProvider>
        <ThemeProvider>
          <TooltipProvider delayDuration={450} skipDelayDuration={100}>
            <KernelBridge client={client} />
            <WorkspaceBridge client={client} />
            <div className="mac-app-window flex h-screen flex-col overflow-hidden bg-background text-foreground">
              <TitleBar />
              {client.deployment ? <div role="status" className="border-b border-border bg-surface-muted px-4 py-2 text-xs text-foreground-muted">{client.deployment.notice}</div> : <LongBridgeBanner />}
              {client.account && <WebAccountPanel />}
              <WorkbenchShell />
            </div>
            <OnboardingOverlay />
            <CommandPalette />
            <Toaster closeButton richColors={false} />
          </TooltipProvider>
        </ThemeProvider>
      </I18nProvider>
    </FinagentClientProvider>
  );
};
