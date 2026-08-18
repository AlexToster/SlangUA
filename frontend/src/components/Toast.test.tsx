import { render, screen, fireEvent, act } from '@testing-library/react';
import { Toast } from './Toast';

function setup(overrides: Partial<Parameters<typeof Toast>[0]> = {}) {
  const props = {
    message: 'Збережено',
    type: 'success' as const,
    onClose: vi.fn(),
    ...overrides,
  };
  render(<Toast {...props} />);
  return props;
}

describe('Toast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('announces itself as an alert carrying the message', () => {
    setup();
    const toast = screen.getByRole('alert');
    expect(toast).toHaveTextContent('Збережено');
    expect(toast).toHaveAttribute('aria-live', 'polite');
  });

  it('carries a class per type', () => {
    const { unmount } = render(<Toast message="m" type="error" onClose={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveClass('toast-error');
    unmount();

    setup({ type: 'info' });
    expect(screen.getByRole('alert')).toHaveClass('toast-info');
  });

  it('closes from the close button', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Закрити' }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('renders no action button unless an action is given', () => {
    setup();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('renders the action and calls it without closing', () => {
    const onClick = vi.fn();
    const props = setup({ action: { label: 'Скасувати', onClick } });
    fireEvent.click(screen.getByRole('button', { name: 'Скасувати' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(props.onClose).not.toHaveBeenCalled();
  });

  describe('auto-dismiss', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('closes itself after five seconds', () => {
      const onClose = vi.fn();
      render(<Toast message="m" type="success" onClose={onClose} />);

      act(() => { vi.advanceTimersByTime(4999); });
      expect(onClose).not.toHaveBeenCalled();

      act(() => { vi.advanceTimersByTime(1); });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    // The timer is cleaned up on unmount: a toast dismissed by hand must not
    // call back into a component that is already gone.
    it('cancels the timer on unmount', () => {
      const onClose = vi.fn();
      const { unmount } = render(<Toast message="m" type="success" onClose={onClose} />);
      unmount();

      act(() => { vi.advanceTimersByTime(10000); });
      expect(onClose).not.toHaveBeenCalled();
    });
  });
});
