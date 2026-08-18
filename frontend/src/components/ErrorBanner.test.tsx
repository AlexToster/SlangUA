import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBanner } from './ErrorBanner';

describe('ErrorBanner', () => {
  it('announces itself assertively with the message', () => {
    render(<ErrorBanner message="Немає звʼязку" />);
    const banner = screen.getByRole('alert');
    expect(banner).toHaveTextContent('Немає звʼязку');
    expect(banner).toHaveAttribute('aria-live', 'assertive');
  });

  it('renders neither button when no handler is given', () => {
    render(<ErrorBanner message="Помилка" />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('adds a class derived from the error code', () => {
    render(<ErrorBanner message="Помилка" code="RATE_LIMITED" />);
    expect(screen.getByRole('alert')).toHaveClass('error-banner-rate_limited');
  });

  it('adds no code class when the code is absent', () => {
    render(<ErrorBanner message="Помилка" />);
    expect(screen.getByRole('alert').className.trim()).toBe('error-banner');
  });

  it('labels the retry action per error code', () => {
    const cases: Array<[string | undefined, string]> = [
      ['RATE_LIMITED', 'Зачекати'],
      ['OFFLINE', 'Спробувати знову'],
      ['AI_PROVIDER_UNAVAILABLE', 'Повторити'],
      [undefined, 'Повторити'],
    ];

    for (const [code, label] of cases) {
      const { unmount } = render(<ErrorBanner message="Помилка" code={code} onRetry={vi.fn()} />);
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
      unmount();
    }
  });

  it('calls onRetry from the retry button', () => {
    const onRetry = vi.fn();
    render(<ErrorBanner message="Помилка" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Повторити' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('calls onDismiss from the labelled close button', () => {
    const onDismiss = vi.fn();
    render(<ErrorBanner message="Помилка" onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: 'Закрити' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('shows both actions together when both handlers are given', () => {
    render(<ErrorBanner message="Помилка" code="OFFLINE" onRetry={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Спробувати знову' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Закрити' })).toBeInTheDocument();
  });
});
