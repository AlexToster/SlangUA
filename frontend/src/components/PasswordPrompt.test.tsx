import { render, screen, fireEvent } from '@testing-library/react';
import { PasswordPrompt } from './PasswordPrompt';

function setup(overrides: Partial<Parameters<typeof PasswordPrompt>[0]> = {}) {
  const props = {
    title: 'Вхід в адмінку',
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  render(<PasswordPrompt {...props} />);
  return props;
}

const field = () => screen.getByLabelText('Пароль адміністратора') as HTMLInputElement;

describe('PasswordPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a modal dialog labelled by its title', () => {
    setup();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Вхід в адмінку');
  });

  // A visible password on a shared screen is the whole risk this masks.
  it('masks the field and offers it to a password manager', () => {
    setup();
    expect(field()).toHaveAttribute('type', 'password');
    expect(field()).toHaveAttribute('autocomplete', 'current-password');
  });

  it('focuses the field on mount', () => {
    setup();
    expect(field()).toHaveFocus();
  });

  it('submits the typed password', () => {
    const props = setup();
    fireEvent.change(field(), { target: { value: 'correct horse battery' } });
    fireEvent.click(screen.getByRole('button', { name: 'Увійти' }));
    expect(props.onSubmit).toHaveBeenCalledWith('correct horse battery');
  });

  it('submits on Enter in the field', () => {
    const props = setup();
    fireEvent.change(field(), { target: { value: 'hunter2hunter2' } });
    fireEvent.submit(field().closest('form')!);
    expect(props.onSubmit).toHaveBeenCalledWith('hunter2hunter2');
  });

  // Otherwise an accidental Enter on an empty field burns one of five attempts.
  it('refuses to submit an empty field', () => {
    const props = setup();
    expect(screen.getByRole('button', { name: 'Увійти' })).toBeDisabled();
    fireEvent.submit(field().closest('form')!);
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it('keeps the dialog open and announces the error after a wrong password', () => {
    setup({ error: 'Невірний пароль' });
    expect(screen.getByRole('alert')).toHaveTextContent('Невірний пароль');
    expect(field()).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('disables the field and both buttons while busy', () => {
    setup({ busy: true });
    fireEvent.change(field(), { target: { value: 'anything at all' } });
    expect(field()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Увійти' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Скасувати' })).toBeDisabled();
  });

  it('cancels on Escape, on the overlay, and from the cancel button', () => {
    const props = setup();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(props.onCancel).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('dialog'));
    expect(props.onCancel).toHaveBeenCalledTimes(1);

    fireEvent.click(document.querySelector('.modal-overlay')!);
    expect(props.onCancel).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('button', { name: 'Скасувати' }));
    expect(props.onCancel).toHaveBeenCalledTimes(3);
    expect(props.onSubmit).not.toHaveBeenCalled();
  });
});
