import React from 'react';
import { Moon, RefreshCw } from 'lucide-react';
import { useAtom, useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { activeSymbolAtom, activeViewAtom, navSectionAtom } from '../../atoms';
import type { WorkspaceView } from '@finagent/core';

const TABS: Array<{ labelKey: string; view: WorkspaceView }> = [
  { labelKey: 'kLines', view: 'chart' },
  { labelKey: 'statements', view: 'financials' },
  { labelKey: 'news', view: 'news' },
  { labelKey: 'reports', view: 'overview' },
];

/** Stitch's persistent center-column header: asset tabs stay available while
 * the existing Felix navigation controls the actual page surface below. */
export const WorkspaceTopbar: React.FC = () => {
  const { t } = useTranslation();
  const activeSymbol = useAtomValue(activeSymbolAtom);
  const navSection = useAtomValue(navSectionAtom);
  const [activeView, setActiveView] = useAtom(activeViewAtom);
  const showAssetTabs = navSection !== 'today' && navSection !== 'alerts' && navSection !== 'events' && navSection !== 'profile' && navSection !== 'settings';

  const selectTab = (view: WorkspaceView) => {
    setActiveView(view);
  };

  return (
    <header className="felix-workspace-topbar flex h-16 shrink-0 items-center justify-between gap-4 border-b border-border bg-surface px-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className="felix-workspace-topbar-title min-w-0 max-w-40">Felix 研究（Felix Research）</div>
        {showAssetTabs && (
          <nav aria-label={t('navigation.workspaceTabs')} className="felix-workspace-topbar-tabs flex h-full items-center gap-3">
            {TABS.map((tab) => (
              <button
                key={tab.labelKey}
                type="button"
                aria-pressed={activeSymbol != null && navSection === 'watchlist' && activeView === tab.view}
                onClick={() => selectTab(tab.view)}
                className={`felix-workspace-topbar-tab ${activeSymbol != null && navSection === 'watchlist' && activeView === tab.view ? 'felix-workspace-topbar-tab--active' : ''}`}
              >
                {t(`navigation.${tab.labelKey}`)}
              </button>
            ))}
          </nav>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3 text-foreground/48">
        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
        <Moon className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="felix-workspace-status"><span />{t('navigation.agentPanel')}</span>
      </div>
    </header>
  );
};
