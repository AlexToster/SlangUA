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
              плашка навколо гліфа (62×36 з макета «Різограф»), а не блок на всю
              висоту смуги. Гліф 26px: раніше було 38px під пігулку на всі 48px,
              але тепер у смуги є власний контур, і плашка стоїть нижчою за неї —
              38px у 36px просто не влазить. */}
          <span className="bottom-nav-glyph">
            <Icon className="bottom-nav-icon" size={26} strokeWidth={2} aria-hidden="true" />
          </span>
          <span className="visually-hidden">{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

export default BottomNav;
