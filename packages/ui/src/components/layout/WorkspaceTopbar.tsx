import React from 'react';
import { Moon, Sun, PanelRight } from 'lucide-react';
import { useAtom, useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { activeSymbolAtom, agentPanelVisibleAtom, navSectionAtom } from '../../atoms';
import { BilingualLabel } from '../primitives/BilingualLabel';
import { useTheme } from './ThemeProvider';

/** Page context and global controls; asset views live next to the quote below. */
export const WorkspaceTopbar: React.FC = () => {
  const { t } = useTranslation();
  const symbol = useAtomValue(activeSymbolAtom);
  const section = useAtomValue(navSectionAtom);
  const [agentVisible, setAgentVisible] = useAtom(agentPanelVisibleAtom);
  const { isDark: dark, setMode } = useTheme();
  const key = section === 'watchlist' || section === 'sessions' ? 'workspace' : section;
  return (
    <header className="felix-workspace-topbar flex shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-5">
      <div className="flex min-w-0 items-center gap-3">
        <h1 className="felix-workspace-topbar-title"><BilingualLabel>{t('navigation.' + key)}</BilingualLabel></h1>
        {section === 'watchlist' && symbol && <span className="felix-workspace-symbol">{symbol}</span>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button type="button" className="felix-topbar-icon" aria-label={dark ? '切换浅色主题（Light theme）' : '切换深色主题（Dark theme）'} onClick={() => setMode(dark ? 'light' : 'dark')}>
          {dark ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <button type="button" className="felix-agent-toggle" aria-label={t('navigation.agentPanel')} aria-pressed={agentVisible} onClick={() => setAgentVisible(!agentVisible)}>
          <PanelRight size={15} /><BilingualLabel>{t('navigation.agentPanel')}</BilingualLabel>
        </button>
      </div>
    </header>
  );
};
