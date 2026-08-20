import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BottomNav } from './BottomNav';
import { triggerHapticFeedback } from '../services/telegram';

vi.mock('../services/telegram', () => ({
  triggerHapticFeedback: vi.fn(),
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <BottomNav />
    </MemoryRouter>
  );
}

describe('BottomNav', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders one link per destination inside a labelled nav', () => {
    renderAt('/');
    expect(screen.getByRole('navigation', { name: 'Основна навігація' })).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(3);
  });

  // All three tabs are glyph-only, so every accessible name comes from visually
  // hidden text. Losing it would leave the bar unnamed for a screen reader.
  it('keeps an accessible name on every icon-only tab', () => {
    renderAt('/');
    expect(screen.getByRole('link', { name: 'Головна' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Історія' })).toHaveAttribute('href', '/history');
    expect(screen.getByRole('link', { name: 'Налаштування' })).toHaveAttribute('href', '/settings');
  });

  // No visible captions at all: the bar is three icons, and any text node inside
  // a tab must stay hidden from sight.
  it('renders no visible label inside the tabs', () => {
    renderAt('/');
    for (const name of ['Головна', 'Історія', 'Налаштування']) {
      const link = screen.getByRole('link', { name });
      expect(link.querySelector('.bottom-nav-glyph svg')).toBeInTheDocument();
      expect(link.textContent).toBe(name);
      expect(link.querySelector('.visually-hidden')).toHaveTextContent(name);
    }
  });

  it('marks exactly the current route as active', () => {
    renderAt('/history');
    expect(screen.getByRole('link', { name: 'Історія' })).toHaveClass('active');
    expect(screen.getByRole('link', { name: 'Головна' })).not.toHaveClass('active');
    expect(screen.getByRole('link', { name: 'Налаштування' })).not.toHaveClass('active');
  });

  // `end` on the "/" tab is what stops it from matching every nested route.
  it('does not mark the home tab active on another route', () => {
    renderAt('/settings');
    expect(screen.getByRole('link', { name: 'Головна' })).not.toHaveClass('active');
    expect(screen.getByRole('link', { name: 'Налаштування' })).toHaveClass('active');
  });

  it('fires selection haptics on a tab press', () => {
    renderAt('/');
    fireEvent.click(screen.getByRole('link', { name: 'Історія' }));
    expect(triggerHapticFeedback).toHaveBeenCalledWith('selection');
  });
});
