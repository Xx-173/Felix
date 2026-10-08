import React from 'react';
import { BilingualLabel } from '../primitives/BilingualLabel';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import type { SettingsTab } from '../../atoms';
import { settingsTabAtom } from '../../atoms';
import { GeneralTab } from './GeneralTab';
import { ModelsTab } from './ModelsTab';
import { ConnectionsCenter } from './ConnectionsCenter';
import { SkillsView } from './SkillsView';
import { DiagnosticsTab } from './DiagnosticsTab';
import { EvaluationSettingsTab } from './EvaluationSettingsTab';
import { PerformanceView } from '../performance/PerformanceView';
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs';

const TABS: Array<{ id: SettingsTab; labelKey: string }> = [
  { id: 'general', labelKey: 'settings.tabs.general' },
  { id: 'llm', labelKey: 'settings.tabs.llm' },
  { id: 'connections', labelKey: 'settings.tabs.connections' },
];

// V9 §71: advanced/developer surfaces are grouped, never equal-weight with the
// everyday settings a normal user touches.
const ADVANCED_TABS: Array<{ id: SettingsTab; labelKey: string }> = [
  { id: 'skills', labelKey: 'settings.tabs.skills' },
  // Performance tab (V5 spec §36–38) — aggregates opinion outcomes.
  { id: 'performance', labelKey: 'settings.tabs.performance' },
  // Agent evaluation (V7 spec §61–63) — LangSmith connection + tracing.
  { id: 'evaluation', labelKey: 'settings.tabs.evaluation' },
  { id: 'diagnostics', labelKey: 'settings.tabs.diagnostics' },
];

export const SettingsView: React.FC = () => {
  const { t } = useTranslation();
  const [tab, setTab] = useAtom(settingsTabAtom);

  return (
    <main className="felix-settings-view flex h-full min-h-0 flex-1 flex-col bg-background">
      <header className="felix-settings-header">
        <div className="flex items-start justify-between gap-4">
          <div><p className="text-[11px] font-semibold uppercase tracking-[.12em] text-accent">{t('settings.preferences')}</p><h1 className="mt-1 text-[24px] font-semibold tracking-[-.02em] text-foreground">{t('settings.title')}</h1></div>
          <p className="max-w-xs pt-1 text-right text-[12px] leading-relaxed text-foreground/48">{t('settings.subtitle')}</p>
        </div>
        <Tabs value={tab} onValueChange={(value) => setTab(value as SettingsTab)} className="felix-settings-tabs">
          <TabsList className="gap-0">
            {TABS.map((tabDef) => <TabsTrigger key={tabDef.id} value={tabDef.id} aria-label={t(tabDef.labelKey)} className="px-3 py-3 text-[12px]"><BilingualLabel>{t(tabDef.labelKey)}</BilingualLabel></TabsTrigger>)}
            <span className="mx-3 flex items-center border-l border-border pl-5 text-[10px] font-semibold uppercase tracking-[.14em] text-foreground/35">
              {t('settings.tabs.advanced')}
            </span>
            {ADVANCED_TABS.map((tabDef) => <TabsTrigger key={tabDef.id} value={tabDef.id} aria-label={t(tabDef.labelKey)} className="px-3 py-3 text-[12px]"><BilingualLabel>{t(tabDef.labelKey)}</BilingualLabel></TabsTrigger>)}
          </TabsList>
        </Tabs>
      </header>
      <div className="felix-settings-content min-h-0 flex-1 overflow-y-auto">
        {tab === 'general' && <GeneralTab />}
        {tab === 'llm' && <ModelsTab />}
        {tab === 'connections' && <ConnectionsCenter />}
        {tab === 'skills' && <SkillsView />}
        {tab === 'diagnostics' && <DiagnosticsTab />}
        {tab === ('performance') && <PerformanceView />}
        {tab === 'evaluation' && <EvaluationSettingsTab />}
      </div>
    </main>
  );
};
