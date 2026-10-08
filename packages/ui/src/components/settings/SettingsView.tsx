import React, { useState } from 'react';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { Database, Sparkles, Settings2, Wrench, ChartNoAxesCombined, FlaskConical, Activity, Stethoscope, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type { SettingsTab } from '../../atoms';
import { settingsTabAtom } from '../../atoms';
import { readPersisted, writePersisted } from '../../lib/persistedPrefs';
import { BilingualLabel } from '../primitives/BilingualLabel';
import { GeneralTab } from './GeneralTab';
import { ModelsTab } from './ModelsTab';
import { ConnectionsCenter } from './ConnectionsCenter';
import { SkillsView } from './SkillsView';
import { DiagnosticsTab } from './DiagnosticsTab';
import { EvaluationSettingsTab } from './EvaluationSettingsTab';
import { PerformanceView } from '../performance/PerformanceView';
import { EvaluationCenter } from '../evaluation/EvaluationCenter';

const CATEGORIES: Array<{ id: SettingsTab; icon: typeof Database }> = [
  { id: 'connections', icon: Database }, { id: 'llm', icon: Sparkles }, { id: 'general', icon: Settings2 },
  { id: 'skills', icon: Wrench }, { id: 'performance', icon: ChartNoAxesCombined },
  { id: 'experiments', icon: FlaskConical }, { id: 'evaluation', icon: Activity }, { id: 'diagnostics', icon: Stethoscope },
];

export const SettingsView: React.FC = () => {
  const { t } = useTranslation();
  const [tab, setTab] = useAtom(settingsTabAtom);
  const [collapsed, setCollapsed] = useState(() => readPersisted<boolean>('settingsMenuCollapsed', false) === true);
  const selected = CATEGORIES.find((item) => item.id === tab)!;
  const Icon = selected.icon;
  return <main className="felix-settings-view flex h-full min-h-0 flex-1 flex-col bg-background">
    <header className="felix-settings-page-heading"><h1><BilingualLabel>{t('settings.title')}</BilingualLabel></h1><p><BilingualLabel>{t('settings.subtitle')}</BilingualLabel></p></header>
    <div className="felix-settings-layout">
      <aside className={`felix-settings-menu ${collapsed ? 'is-collapsed' : ''}`} data-testid="settings-menu">
        <button type="button" className="felix-settings-collapse" data-testid="settings-menu-collapse" aria-expanded={!collapsed} aria-label={t(collapsed ? 'settings.menu.expand' : 'settings.menu.collapse')} title={t(collapsed ? 'settings.menu.expand' : 'settings.menu.collapse')} onClick={() => { setCollapsed(!collapsed); writePersisted('settingsMenuCollapsed', !collapsed); }}>
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}<span><BilingualLabel>{t('settings.menu.collapse')}</BilingualLabel></span>
        </button>
        <div role="tablist" aria-orientation="vertical" aria-label={t('settings.title')}>
          {CATEGORIES.map((item, index) => {
            const ItemIcon = item.icon;
            return <React.Fragment key={item.id}>
              {index === 3 && <p className="felix-settings-advanced"><BilingualLabel>{t('settings.tabs.advanced')}</BilingualLabel></p>}
              <button type="button" role="tab" id={`settings-tab-${item.id}`} aria-controls="settings-panel" aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1} aria-label={t(`settings.menu.${item.id}`)} title={t(`settings.menu.${item.id}`)} onClick={() => setTab(item.id)} onKeyDown={(event) => {
                if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? CATEGORIES.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + CATEGORIES.length) % CATEGORIES.length;
                const next = CATEGORIES[nextIndex]!.id; setTab(next); document.getElementById(`settings-tab-${next}`)?.focus();
              }}><ItemIcon size={18} /><span><BilingualLabel>{t(`settings.menu.${item.id}`)}</BilingualLabel></span></button>
            </React.Fragment>;
          })}
        </div>
      </aside>
      <section className="felix-settings-card" id="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${tab}`}>
        <header className="felix-settings-category-heading"><Icon size={21} /><div><h2><BilingualLabel>{t(`settings.menu.${tab}`)}</BilingualLabel></h2><p><BilingualLabel>{t(`settings.menuDescriptions.${tab}`)}</BilingualLabel></p></div></header>
        <div className="felix-settings-content">
          {tab === 'general' && <GeneralTab />}{tab === 'llm' && <ModelsTab />}
          {tab === 'connections' && <ConnectionsCenter />}{tab === 'skills' && <SkillsView />}
          {tab === 'diagnostics' && <DiagnosticsTab />}{tab === 'performance' && <PerformanceView />}
          {tab === 'experiments' && <EvaluationCenter />}{tab === 'evaluation' && <EvaluationSettingsTab />}
        </div>
      </section>
    </div>
  </main>;
};
