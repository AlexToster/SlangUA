import { fireEvent, render, screen } from '@testing-library/react';
import { StyleSelector } from './StyleSelector';
import type { Style } from '../types/api';

const styles: Style[] = [
  { id: 'GEN_Z', title: 'Gen Z' },
  { id: 'STREET', title: 'Вуличний' },
];

describe('StyleSelector', () => {
  const onSelect = vi.fn();
  const onToggle = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows every available style in the open sheet and selects one', () => {
    render(
      <StyleSelector
        styles={styles}
        selectedStyle="GEN_Z"
        onSelect={onSelect}
        isOpen
        onToggle={onToggle}
      />,
    );

    expect(screen.getByRole('option', { name: 'Gen Z' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: 'Вуличний' }));
    expect(onSelect).toHaveBeenCalledWith('STREET');
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it('shows a visible retry state when styles cannot be loaded', () => {
    const onRetry = vi.fn();
    render(
      <StyleSelector
        styles={[]}
        selectedStyle={null}
        onSelect={onSelect}
        isOpen
        onToggle={onToggle}
        isError
        isAuthenticated
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText('Не вдалося завантажити стилі.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Спробувати ще раз' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('sends a locked Pofeni selection to age confirmation instead of selecting it', () => {
    const onLockedSelect = vi.fn();
    render(
      <StyleSelector
        styles={[...styles, { id: 'POFENI', title: 'Пофені' }]}
        selectedStyle="GEN_Z"
        onSelect={onSelect}
        isOpen
        onToggle={onToggle}
        lockedStyleIds={['POFENI']}
        onLockedSelect={onLockedSelect}
      />,
    );

    fireEvent.click(screen.getByRole('option', { name: /Пофені/ }));
    expect(onLockedSelect).toHaveBeenCalledWith('POFENI');
    expect(onSelect).not.toHaveBeenCalledWith('POFENI');
  });
});
