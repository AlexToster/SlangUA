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

  // The two secondary tabs are glyph-only, so their accessible name comes from
  // visually hidden text. Losing it would leave them unnamed for a screen reader.
  it('keeps an accessible name on the icon-only tabs', () => {
    renderAt('/');
    expect(screen.getByRole('link', { name: 'Переклад' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Історія' })).toHaveAttribute('href', '/history');
    expect(screen.getByRole('link', { name: 'Налаштування' })).toHaveAttribute('href', '/settings');
  });

  it('renders the primary tab as text and the others as icons', () => {
    renderAt('/');
    expect(screen.getByRole('link', { name: 'Переклад' })).toHaveClass('text-only');
    expect(screen.getByRole('link', { name: 'Історія' })).toHaveClass('icon-only');
    expect(screen.getByRole('link', { name: 'Налаштування' })).toHaveClass('icon-only');
  });

  it('marks exactly the current route as active', () => {
    renderAt('/history');
    expect(screen.getByRole('link', { name: 'Історія' })).toHaveClass('active');
    expect(screen.getByRole('link', { name: 'Переклад' })).not.toHaveClass('active');
    expect(screen.getByRole('link', { name: 'Налаштування' })).not.toHaveClass('active');
  });

  // `end` on the "/" tab is what stops it from matching every nested route.
  it('does not mark the translate tab active on another route', () => {
    renderAt('/settings');
    expect(screen.getByRole('link', { name: 'Переклад' })).not.toHaveClass('active');
    expect(screen.getByRole('link', { name: 'Налаштування' })).toHaveClass('active');
  });

  it('fires selection haptics on a tab press', () => {
    renderAt('/');
    fireEvent.click(screen.getByRole('link', { name: 'Історія' }));
    expect(triggerHapticFeedback).toHaveBeenCalledWith('selection');
  });
});
