import React from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Database, ShieldCheck, Star, TrendingUp } from 'lucide-react';
import { useAtomValue } from 'jotai';
import { watchlistAtom, assistantWorkspaceContextAtom } from '../../atoms';

const groups = [
  { id: 'market', icon: TrendingUp },
  { id: 'stocks', icon: Star },
  { id: 'research', icon: ShieldCheck },
  { id: 'data', icon: Database },
] as const;

/** Suggestions are editable drafts. Opening the assistant never starts a paid run. */
export const AssistantWelcome: React.FC<{ onPick: (text: string) => void }> = ({ onPick }) => {
  const { t } = useTranslation();
  const context = useAtomValue(assistantWorkspaceContextAtom);
  const watchlist = useAtomValue(watchlistAtom);
  return <div className="felix-assistant-welcome" data-testid="agent-suggestions">
    <section className="felix-assistant-hero">
      <span className="felix-assistant-bot"><Bot size={28} /></span>
      <h2>{t('agent.welcome.title')}</h2>
      <p>{t('agent.welcome.subtitle')}</p>
    </section>
    {groups.map(({ id, icon: Icon }) => <section key={id} className="felix-assistant-group" data-testid={`assistant-group-${id}`}>
      <h3><Icon size={16} />{t(`agent.welcome.${id}.title`)}</h3>
      <div className="felix-assistant-questions">
        {(t(`agent.welcome.${id}.labels`, { returnObjects: true }) as string[]).map((label, index) => <button
          type="button" key={label} onClick={() => {
            const scope = context.activeSymbol
              ? t('agent.welcome.symbolScope', { symbol: context.activeSymbol })
              : t('agent.welcome.noSymbolScope');
            const symbols = watchlist.length > 0 ? watchlist.join(', ') : t('agent.welcome.noWatchlistScope');
            // Fetch current evidence when the user sends; do not inject cached prices as facts.
            onPick(t(`agent.welcome.${id}.prompts.${index}`, { scope, symbols }));
          }}>{label}</button>)}
      </div>
    </section>)}
    <section className="felix-assistant-evidence-note">
      <ShieldCheck size={18} /><div><h3>{t('agent.welcome.evidenceTitle')}</h3><p>{t('agent.welcome.evidenceBody')}</p></div>
    </section>
  </div>;
};
