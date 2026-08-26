import { render, screen, fireEvent } from '@testing-library/react';
import { PreviewResult } from './PreviewResult';
import type { PreviewResult as PreviewResultType, SlangStyle } from '../types/api';

const mockPreview: PreviewResultType = {
  originalText: 'Привіт',
  translatedText: 'Привіт, як справи?',
  slangStyle: 'GEN_Z',
  providerId: 'openai',
  previewId: 'preview-123',
};

describe('PreviewResult', () => {
  const defaultProps = {
    preview: mockPreview,
    isLoading: false,
    isError: false,
    errorBanner: null,
    onRetry: vi.fn(),
    selectedStyle: 'GEN_Z' as SlangStyle,
    draftText: 'Привіт',
    onCopy: vi.fn(),
    onSave: vi.fn(),
    canSave: true,
    isSaving: false,
    onShare: vi.fn(),
    canShare: true,
    isSharing: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows empty state when no draft text', () => {
    render(<PreviewResult {...defaultProps} draftText="" preview={null} />);
    expect(screen.getByText('Переклад з\'явиться автоматично')).toBeInTheDocument();
    // Порожнє поле показує тільки цей рядок: підказка про мінімум символів
    // з'являється лише тоді, коли текст уже набирають (fallback-стан нижче).
    expect(screen.queryByText(/Мінімум 3 символи/)).not.toBeInTheDocument();
  });
  
  it('shows loading skeleton when loading and no preview', () => {
    render(<PreviewResult {...defaultProps} isLoading={true} preview={null} draftText="Привіт" />);
    expect(screen.getByText('Перекладаємо…')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
  
  it('shows updating state when loading with existing preview', () => {
    render(<PreviewResult {...defaultProps} isLoading={true} />);
    expect(screen.getByText('Привіт, як справи?')).toBeInTheDocument();
    expect(screen.getByText('Оновлюємо…')).toBeInTheDocument();
  });
  
  it('shows error state when isError', () => {
    render(<PreviewResult {...defaultProps} isError={true} errorBanner={{ message: 'Test error', code: 'TEST' }} />);
    expect(screen.getByText('Test error')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
  
  it('shows success state with preview', () => {
    render(<PreviewResult {...defaultProps} />);
    expect(screen.getByText('Привіт, як справи?')).toBeInTheDocument();
    expect(screen.getByText('Молодіжний тікток-сленг')).toBeInTheDocument();
    expect(screen.getByText('OpenAI')).toBeInTheDocument();
  });

  // Instance ids are free-form since the backend dropped the AIProvider enum,
  // so a deployment-specific id must still render as a label.
  it('uppercases an unknown provider id', () => {
    render(<PreviewResult {...defaultProps} preview={{ ...mockPreview, providerId: 'groq' }} />);
    expect(screen.getByText('GROQ')).toBeInTheDocument();
  });
  
  it('calls onCopy when copy button clicked', () => {
    render(<PreviewResult {...defaultProps} />);
    const copyButton = screen.getByLabelText('Копіювати результат');
    fireEvent.click(copyButton);
    expect(defaultProps.onCopy).toHaveBeenCalledWith('Привіт, як справи?');
  });
  
  it('shows "Скопійовано" after copy', () => {
    render(<PreviewResult {...defaultProps} />);
    const copyButton = screen.getByLabelText('Копіювати результат');
    fireEvent.click(copyButton);
    expect(screen.getByText('Скопійовано')).toBeInTheDocument();
  });
  
  it('calls onSave when save button clicked', () => {
    render(<PreviewResult {...defaultProps} />);
    const saveButton = screen.getByLabelText('Зберегти в історію');
    fireEvent.click(saveButton);
    expect(defaultProps.onSave).toHaveBeenCalled();
  });

  it('calls onShare when Telegram sharing is available', () => {
    render(<PreviewResult {...defaultProps} />);
    fireEvent.click(screen.getByLabelText('Надіслати в Telegram'));
    expect(defaultProps.onShare).toHaveBeenCalled();
  });

  it('does not show the share action when the result is ineligible', () => {
    render(<PreviewResult {...defaultProps} canShare={false} />);
    expect(screen.queryByLabelText('Надіслати в Telegram')).not.toBeInTheDocument();
  });
  
  it('disables save button when cannot save', () => {
    render(<PreviewResult {...defaultProps} canSave={false} />);
    const saveButton = screen.getByLabelText('Зберегти в історію');
    expect(saveButton).toBeDisabled();
  });
  
  it('shows loading state on save button when isSaving', () => {
    render(<PreviewResult {...defaultProps} isSaving={true} />);
    const saveButton = screen.getByLabelText('Зберігаємо...');
    expect(saveButton).toBeInTheDocument();
  });
  
  it('calls onRetry when retry button clicked in error state', () => {
    render(<PreviewResult {...defaultProps} isError={true} errorBanner={{ message: 'Error', code: 'TEST' }} />);
    const retryButton = screen.getByText('Оновити');
    fireEvent.click(retryButton);
    expect(defaultProps.onRetry).toHaveBeenCalled();
  });

  it('waits to show retry until automatic attempts are exhausted', () => {
    render(<PreviewResult {...defaultProps} isError={true} canRetry={false} />);
    expect(screen.queryByText('Оновити')).not.toBeInTheDocument();
  });
  
  it('shows minimum chars hint when text too short', () => {
    render(<PreviewResult {...defaultProps} draftText="Hi" preview={null} />);
    expect(screen.getByText('Мінімум 3 символи для перекладу')).toBeInTheDocument();
  });
});
