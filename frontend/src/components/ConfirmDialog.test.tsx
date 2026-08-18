import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmDialog } from './ConfirmDialog';

function setup(overrides: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const props = {
    title: 'Очистити історію?',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  render(<ConfirmDialog {...props} />);
  return props;
}

describe('ConfirmDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a modal dialog labelled by its title', () => {
    setup();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Очистити історію?');
  });

  it('renders body copy only when given', () => {
    const { unmount } = render(<ConfirmDialog title="Заголовок" onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(document.querySelector('.modal-text')).toBeNull();
    unmount();

    setup({ text: 'Це не можна скасувати.' });
    expect(screen.getByText('Це не можна скасувати.')).toBeInTheDocument();
  });

  it('defaults the labels to Так/Скасувати and allows overriding them', () => {
    const { unmount } = render(<ConfirmDialog title="t" onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Так' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Скасувати' })).toBeInTheDocument();
    unmount();

    setup({ confirmLabel: 'Видалити', cancelLabel: 'Ні' });
    expect(screen.getByRole('button', { name: 'Видалити' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ні' })).toBeInTheDocument();
  });

  it('focuses the confirm button on mount', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Так' })).toHaveFocus();
  });

  it('calls onConfirm and onCancel from the matching buttons', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Так' }));
    expect(props.onConfirm).toHaveBeenCalledTimes(1);
    expect(props.onCancel).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Скасувати' }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it('cancels on Escape', () => {
    const props = setup();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(props.onCancel).toHaveBeenCalledTimes(1);
    expect(props.onConfirm).not.toHaveBeenCalled();
  });

  it('cancels on a click on the overlay but not inside the dialog', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('dialog'));
    expect(props.onCancel).not.toHaveBeenCalled();

    const overlay = document.querySelector('.modal-overlay');
    expect(overlay).not.toBeNull();
    fireEvent.click(overlay!);
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it('renders the destructive style only when danger is set', () => {
    const { unmount } = render(<ConfirmDialog title="t" onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Так' })).toHaveClass('btn-primary');
    unmount();

    setup({ danger: true });
    expect(screen.getByRole('button', { name: 'Так' })).toHaveClass('btn-danger');
  });

  // busy is what keeps a slow "clear history" from being fired twice.
  it('disables both buttons while busy', () => {
    setup({ busy: true });
    expect(screen.getByRole('button', { name: 'Так' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Скасувати' })).toBeDisabled();
  });
});
