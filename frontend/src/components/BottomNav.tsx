import { NavLink } from 'react-router-dom';
import { History, Settings } from 'lucide-react';
import { triggerHapticFeedback } from '../services/telegram';
import './BottomNav.css';

interface NavItem {
  to: string;
  label: string;
  /** Icon-only tabs pass a component; the primary tab renders its label instead. */
  Icon?: typeof History;
  flex: number;
  end?: boolean;
}

// Tabs, not a labelled icon bar: "Переклад" is a wide text tab taking half the
// width, the two secondary destinations are large glyphs only. Their labels stay
// in the DOM as visually hidden text so the accessible name is unchanged.
const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Переклад', flex: 2, end: true },
  { to: '/history', label: 'Історія', Icon: History, flex: 1 },
  { to: '/settings', label: 'Налаштування', Icon: Settings, flex: 1 },
];

export function BottomNav() {
  return (
    <nav className="bottom-nav" aria-label="Основна навігація">
      {NAV_ITEMS.map(({ to, label, Icon, flex, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `bottom-nav-item${Icon ? ' icon-only' : ' text-only'}${isActive ? ' active' : ''}`
          }
          style={{ flex }}
          onClick={() => triggerHapticFeedback('selection')}
        >
          {Icon ? (
            <>
              <Icon className="bottom-nav-icon" size={30} strokeWidth={2} aria-hidden="true" />
              <span className="visually-hidden">{label}</span>
            </>
          ) : (
            <span className="bottom-nav-label">{label}</span>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

export default BottomNav;
