import React from 'react';
import { useTranslation } from 'react-i18next';
import { BilingualLabel } from '../primitives/BilingualLabel';
import { Watchlist } from '../stock/Watchlist';

export const WorkspaceHome: React.FC = () => {
  const { t } = useTranslation();
  return <main className="felix-workspace-home" data-testid="workspace-home">
    <div className="felix-hub-heading"><div>
      <h2><BilingualLabel>{t('navigation.watchlist')}</BilingualLabel></h2>
      <p><BilingualLabel>{t('navigation.watchlistCompactIntro')}</BilingualLabel></p>
    </div></div>
    <section className="felix-hub-panel"><Watchlist fullPage showHeader={false} /></section>
  </main>;
};
