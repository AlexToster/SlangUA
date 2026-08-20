import { render, screen, fireEvent } from '@testing-library/react';
import { StyleDropdown } from './StyleDropdown';
import type { Style, SlangStyle } from '../types/api';
import { STYLE_LABELS } from '../utils/styleLabels';

const STYLES: Style[] = [
  { id: 'GEN_Z', title: STYLE_LABELS.GEN_Z, ageRestricted: false },
  { id: 'STREET', title: STYLE_LABELS.STREET, ageRestricted: false },
  { id: 'IT_SLANG', title: STYLE_LABELS.IT_SLANG, ageRestricted: false },
  { id: 'POFENI', title: STYLE_LABELS.POFENI, ageRestricted: true },
];

function setup(overrides: Partial<Parameters<typeof StyleDropdown>[0]> = {}) {
  const props = {
    styles: STYLES,
    selectedStyle: 'GEN_Z' as SlangStyle | null,
    onSelect: vi.fn(),
    onLockedSelect: vi.fn(),
    ...overrides,
  };
  render(<StyleDropdown {...props} />);
  return props;
}

const openPanel = () => {
  fireEvent.click(screen.getByRole('button', { name: /Вибраний стиль/ }));
  return screen.getByRole('listbox');
};
const highlighted = () => document.querySelector('.style-dropdown-item.highlighted');

describe('StyleDropdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the selected style on the trigger and no panel until opened', () => {
    setup();
    expect(screen.getByText(STYLE_LABELS.GEN_Z)).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('falls back to a prompt when nothing is selected', () => {
    setup({ selectedStyle: null });
    expect(screen.getByText('Оберіть стиль')).toBeInTheDocument();
  });

  it('opens on click and lists every style as an option', () => {
    setup();
    const panel = openPanel();
    expect(panel).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(STYLES.length);
    expect(screen.getByRole('button', { name: /Вибраний стиль/ })).toHaveAttribute('aria-expanded', 'true');
  });

  it('reports the selected option through aria-selected', () => {
    setup({ selectedStyle: 'STREET' });
    openPanel();
    const selected = screen.getAllByRole('option').filter((o) => o.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);
    expect(selected[0]).toHaveTextContent(STYLE_LABELS.STREET);
  });

  it('calls onSelect and closes when an unlocked option is clicked', () => {
    const props = setup();
    openPanel();
    fireEvent.click(screen.getByRole('option', { name: new RegExp(STYLE_LABELS.IT_SLANG) }));
    expect(props.onSelect).toHaveBeenCalledWith('IT_SLANG');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  // The age gate lives on the server; this only checks the client stops short of
  // selecting a locked style and routes the click to the confirmation flow.
  it('routes a locked style to onLockedSelect instead of onSelect', () => {
    const props = setup({ lockedStyleIds: ['POFENI'] });
    openPanel();
    fireEvent.click(screen.getByRole('option', { name: new RegExp(STYLE_LABELS.POFENI) }));
    expect(props.onLockedSelect).toHaveBeenCalledWith('POFENI');
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it('marks a locked style with an 18+ badge', () => {
    setup({ lockedStyleIds: ['POFENI'] });
    openPanel();
    const option = screen.getByRole('option', { name: new RegExp(STYLE_LABELS.POFENI) });
    expect(option).toHaveClass('locked');
    expect(option).toHaveTextContent('18+');
  });

  it('selects a locked style normally once it is not in lockedStyleIds', () => {
    const props = setup({ lockedStyleIds: [] });
    openPanel();
    fireEvent.click(screen.getByRole('option', { name: new RegExp(STYLE_LABELS.POFENI) }));
    expect(props.onSelect).toHaveBeenCalledWith('POFENI');
    expect(props.onLockedSelect).not.toHaveBeenCalled();
  });

  it('opens with ArrowDown from the trigger, highlighting the selected style', () => {
    setup({ selectedStyle: 'IT_SLANG' });
    fireEvent.keyDown(screen.getByRole('button', { name: /Вибраний стиль/ }), { key: 'ArrowDown' });
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(highlighted()).toHaveTextContent(STYLE_LABELS.IT_SLANG);
  });

  it('opens with ArrowUp on the last style when nothing is selected', () => {
    setup({ selectedStyle: null });
    fireEvent.keyDown(screen.getByRole('button', { name: /Вибраний стиль/ }), { key: 'ArrowUp' });
    expect(highlighted()).toHaveTextContent(STYLE_LABELS.POFENI);
  });

  // The panel is a 2-column grid, so ArrowDown/ArrowUp move by COLUMNS (2), not one.
  it('moves the highlight one column with ArrowDown and ArrowUp', () => {
    setup({ selectedStyle: 'POFENI' });
    const panel = openPanel();
    expect(highlighted()).toHaveTextContent(STYLE_LABELS.POFENI);

    // From POFENI (index 3): (3 + 2) % 4 = 1 → STREET.
    fireEvent.keyDown(panel, { key: 'ArrowDown' });
    expect(highlighted()).toHaveTextContent(STYLE_LABELS.STREET);

    // From STREET (index 1): (1 - 2 + 4) % 4 = 3 → POFENI.
    fireEvent.keyDown(panel, { key: 'ArrowUp' });
    expect(highlighted()).toHaveTextContent(STYLE_LABELS.POFENI);
  });

  it('moves the highlight with ArrowRight and ArrowLeft, wrapping at both ends', () => {
    setup({ selectedStyle: 'GEN_Z' });
    const panel = openPanel();
    expect(highlighted()).toHaveTextContent(STYLE_LABELS.GEN_Z);

    // (0 + 1) % 4 = 1 → STREET.
    fireEvent.keyDown(panel, { key: 'ArrowRight' });
    expect(highlighted()).toHaveTextContent(STYLE_LABELS.STREET);

    // (1 - 1 + 4) % 4 = 0 → GEN_Z.
    fireEvent.keyDown(panel, { key: 'ArrowLeft' });
    expect(highlighted()).toHaveTextContent(STYLE_LABELS.GEN_Z);

    // ArrowLeft from the first tile wraps to the last: (0 - 1 + 4) % 4 = 3 → POFENI.
    fireEvent.keyDown(panel, { key: 'ArrowLeft' });
    expect(highlighted()).toHaveTextContent(STYLE_LABELS.POFENI);

    // ArrowRight from the last tile wraps to the first: (3 + 1) % 4 = 0 → GEN_Z.
    fireEvent.keyDown(panel, { key: 'ArrowRight' });
    expect(highlighted()).toHaveTextContent(STYLE_LABELS.GEN_Z);
  });

  it('moves ArrowDown from the first tile COLUMNS positions later', () => {
    setup({ selectedStyle: 'GEN_Z' });
    const panel = openPanel();
    expect(highlighted()).toHaveTextContent(STYLE_LABELS.GEN_Z);

    // COLUMNS = 2: (0 + 2) % 4 = 2 → IT_SLANG.
    fireEvent.keyDown(panel, { key: 'ArrowDown' });
    expect(highlighted()).toHaveTextContent(STYLE_LABELS.IT_SLANG);
  });

  it('jumps to the first and last style with Home and End', () => {
    setup({ selectedStyle: 'STREET' });
    const panel = openPanel();

    fireEvent.keyDown(panel, { key: 'End' });
    expect(highlighted()).toHaveTextContent(STYLE_LABELS.POFENI);

    fireEvent.keyDown(panel, { key: 'Home' });
    expect(highlighted()).toHaveTextContent(STYLE_LABELS.GEN_Z);
  });

  it('tracks the highlight through aria-activedescendant', () => {
    setup({ selectedStyle: 'GEN_Z' });
    const panel = openPanel();
    fireEvent.keyDown(panel, { key: 'End' });
    const last = screen.getByRole('option', { name: new RegExp(STYLE_LABELS.POFENI) });
    expect(panel).toHaveAttribute('aria-activedescendant', last.id);
  });

  it('selects the highlighted style with Enter and with Space', () => {
    const props = setup({ selectedStyle: 'GEN_Z' });
    fireEvent.keyDown(openPanel(), { key: 'End' });
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Enter' });
    expect(props.onSelect).toHaveBeenCalledWith('POFENI');

    // ArrowRight moves one tile (GEN_Z → STREET); this test covers Enter/Space
    // selection, while the grid-specific ArrowDown motion has its own tests above.
    fireEvent.keyDown(openPanel(), { key: 'ArrowRight' });
    fireEvent.keyDown(screen.getByRole('listbox'), { key: ' ' });
    expect(props.onSelect).toHaveBeenLastCalledWith('STREET');
  });

  it('closes on Escape without selecting', () => {
    const props = setup();
    fireEvent.keyDown(openPanel(), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it('closes on Tab so focus can leave the control', () => {
    setup();
    fireEvent.keyDown(openPanel(), { key: 'Tab' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('closes on an outside click', () => {
    setup();
    openPanel();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('moves the highlight on hover', () => {
    setup({ selectedStyle: 'GEN_Z' });
    openPanel();
    fireEvent.mouseEnter(screen.getByRole('option', { name: new RegExp(STYLE_LABELS.IT_SLANG) }));
    expect(highlighted()).toHaveTextContent(STYLE_LABELS.IT_SLANG);
  });

  it('survives an empty style list', () => {
    setup({ styles: [], selectedStyle: null });
    const button = screen.getByRole('button', { name: /Вибраний стиль/ });
    fireEvent.keyDown(button, { key: 'ArrowDown' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    fireEvent.click(button);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  // Геометрія панелі. Смуга навігації лежить поверх панелі, тому низ сітки мусить
  // зупинитися вище її верхнього краю: інакше закруглений нижній край панелі
  // ховається за смугою.
  describe('panel geometry', () => {
    const originalInnerHeight = window.innerHeight;

    beforeEach(() => {
      window.innerHeight = 800;
    });

    afterEach(() => {
      window.innerHeight = originalInnerHeight;
      document.querySelector('.bottom-nav')?.remove();
    });

    function addNavBar(top: number) {
      const nav = document.createElement('nav');
      nav.className = 'bottom-nav';
      nav.getBoundingClientRect = () =>
        ({ top, bottom: window.innerHeight, height: window.innerHeight - top, left: 0, right: 390, width: 390, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
      document.body.appendChild(nav);
      return nav;
    }

    it('stops above the nav bar, leaving a gap for the rounded bottom edge', () => {
      addNavBar(700);
      setup();
      const panel = openPanel();

      // Тригер у jsdom має нульовий rect, тож низ панелі — верх смуги (700) мінус
      // зазор 8.
      expect(panel.style.getPropertyValue('--style-dropdown-max-h')).toBe('692px');
    });

    it('falls back to the viewport when there is no nav bar in the DOM', () => {
      setup();
      const panel = openPanel();
      expect(panel.style.getPropertyValue('--style-dropdown-max-h')).toBe('792px');
    });
  });
});
