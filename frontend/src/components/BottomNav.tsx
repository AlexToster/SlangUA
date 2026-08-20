import { NavLink } from 'react-router-dom';
import { Home, History, Settings } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { triggerHapticFeedback } from '../services/telegram';
import './BottomNav.css';

interface NavItem {
  to: string;
  label: string;
  Icon: LucideIcon;
  end?: boolean;
}

// Три однакові гліфові вкладки, без жодного видимого підпису: будинок — головний
// екран, годинник — історія, шестерня — налаштування. Раніше «Переклад» був
// широкою текстовою вкладкою на пів смуги; тепер усі три рівні за шириною.
// Підписи лишаються в DOM як visually hidden — це єдине джерело доступної назви
// кнопки, тож видаляти їх не можна.
const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Головна', Icon: Home, end: true },
  { to: '/history', label: 'Історія', Icon: History },
  { to: '/settings', label: 'Налаштування', Icon: Settings },
];

export function BottomNav() {
  return (
    <nav className="bottom-nav" aria-label="Основна навігація">
      {NAV_ITEMS.map(({ to, label, Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) => `bottom-nav-item${isActive ? ' active' : ''}`}
          onClick={() => triggerHapticFeedback('selection')}
        >
          {/* Окрема обгортка, а не сам <a>: підсвітка активної вкладки — компактна
              пігулка навколо гліфа, а не блок на всю висоту смуги. Розмір гліфа
              38px: 28 → 42 (×1.5) на прохання власника, потім на крок сетки (4px)
              менше. Пігулка в BottomNav.css тягнеться на всю висоту смуги. */}
          <span className="bottom-nav-glyph">
            <Icon className="bottom-nav-icon" size={38} strokeWidth={2} aria-hidden="true" />
          </span>
          <span className="visually-hidden">{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

export default BottomNav;
