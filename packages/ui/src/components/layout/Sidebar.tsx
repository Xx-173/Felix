import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAtom, useSetAtom } from 'jotai';
import {
  Bell,
  BookOpen,
  BriefcaseBusiness,
  CalendarDays,
  ChartNoAxesCombined,
  CircleHelp,
  Compass,
  FileText,
  FlaskConical,
  GitCompareArrows,
  LayoutDashboard,
  Settings,
  UserRound,
  Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  mobileAgentVisibleAtom,
  navSectionAtom,
  type NavSection,
} from '../../atoms';
import { BilingualLabel } from '../primitives/BilingualLabel';

type SidebarItem = { key: NavSection; labelKey: string; icon: LucideIcon };

const SIDEBAR_ITEMS: SidebarItem[] = [
  { key: 'today', labelKey: 'today', icon: LayoutDashboard },
  { key: 'discover', labelKey: 'discover', icon: Compass },
  { key: 'workspace', labelKey: 'workspace', icon: ChartNoAxesCombined },
  { key: 'portfolio', labelKey: 'portfolio', icon: BriefcaseBusiness },
  { key: 'compare', labelKey: 'compare', icon: GitCompareArrows },
  { key: 'alerts', labelKey: 'alerts', icon: Bell },
  { key: 'research', labelKey: 'research', icon: BookOpen },
  { key: 'thesis', labelKey: 'thesis', icon: FileText },
  { key: 'skills', labelKey: 'skills', icon: Zap },
  { key: 'evaluation', labelKey: 'evaluation', icon: FlaskConical },
  { key: 'events', labelKey: 'events', icon: CalendarDays },
];

const SidebarNavButton: React.FC<{
  item: SidebarItem;
  label: string;
  active: boolean;
  onClick: () => void;
}> = ({ item, label, active, onClick }) => {
  const Icon = item.icon;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={`felix-sidebar-nav-item ${active ? 'felix-sidebar-nav-item--active' : ''}`}
    >
      <Icon className="h-4 w-4 shrink-0" strokeWidth={active ? 2 : 1.7} />
      <span className="felix-sidebar-nav-label"><BilingualLabel stacked>{label}</BilingualLabel></span>
      {item.key === 'alerts' && <span className="felix-sidebar-alert-dot" aria-hidden="true" />}
    </button>
  );
};

export const Sidebar: React.FC = () => {
  const { t } = useTranslation();
  const showMobileAgent = useSetAtom(mobileAgentVisibleAtom);
  const [navSection, setNavSection] = useAtom(navSectionAtom);

  return (
    <aside className="felix-sidebar h-full w-full overflow-hidden bg-surface" data-testid="sidebar">
      <div className="felix-sidebar-content flex h-full min-w-0 flex-col px-3 py-5">
        <div className="felix-sidebar-brand mb-6 px-2">
          <div className="felix-sidebar-brand-name">Felix</div>
          <div className="felix-sidebar-brand-kicker">{t('navigation.institutionalResearch')}</div>
        </div>

        <nav aria-label={t('navigation.globalNavAria')} className="felix-sidebar-nav flex min-h-0 flex-1 flex-col gap-1">
          {SIDEBAR_ITEMS.map((item) => (
            <SidebarNavButton
              key={item.key}
              item={item}
              label={t(`navigation.${item.labelKey}`)}
              active={navSection === item.key || (item.key === 'workspace' && ['watchlist', 'sessions'].includes(navSection))}
              onClick={() => { setNavSection(item.key); showMobileAgent(false); }}
            />
          ))}
          <SidebarNavButton
            item={{ key: 'profile', labelKey: 'profile', icon: UserRound }}
            label={t('navigation.profile')}
            active={navSection === 'profile'}
            onClick={() => { setNavSection('profile'); showMobileAgent(false); }}
          />
        </nav>

        <div className="felix-sidebar-footer mt-auto border-t border-border pt-3">
          <SidebarNavButton
            item={{ key: 'settings', labelKey: 'settings', icon: Settings }}
            label={t('navigation.settings')}
            active={navSection === 'settings'}
            onClick={() => { setNavSection('settings'); showMobileAgent(false); }}
          />
          <div className="felix-sidebar-support flex items-center gap-2 px-3 py-2 text-[11px] text-foreground/45">
            <CircleHelp className="h-4 w-4" />
            <span>{t('navigation.support')}</span>
          </div>
        </div>
      </div>

    </aside>
  );
};
