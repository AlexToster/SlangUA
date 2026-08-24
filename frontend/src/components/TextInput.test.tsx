import { render, screen, fireEvent } from '@testing-library/react';
import { TextInput, type VoiceInputControl, type VoiceInputState } from './TextInput';

describe('TextInput', () => {
  const defaultProps = {
    value: '',
    onChange: vi.fn(),
    onRandomPhrase: vi.fn(),
    isRandomPhraseDisabled: false,
    graphemeCount: 0,
    maxGraphemes: 1000,
    isWarningZone: false,
    isOverLimit: false,
    placeholder: 'Test placeholder',
  };

  /** The prop the page passes only when this deployment can record at all. */
  const onToggle = vi.fn();
  const onCancel = vi.fn();
  const sampleLevel = vi.fn(() => 0.5);
  const voice = (state: VoiceInputState, elapsedSeconds: number | null = null): VoiceInputControl => ({
    state,
    elapsedSeconds,
    progress: elapsedSeconds === null ? 0 : elapsedSeconds / 30,
    onToggle,
    onCancel,
    sampleLevel,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });
  
  it('renders textarea with placeholder', () => {
    render(<TextInput {...defaultProps} />);
    const textarea = screen.getByPlaceholderText('Test placeholder');
    expect(textarea).toBeInTheDocument();
  });
  
  it('calls onChange when typing', () => {
    render(<TextInput {...defaultProps} />);
    const textarea = screen.getByPlaceholderText('Test placeholder');
    fireEvent.change(textarea, { target: { value: 'Hello' } });
    expect(defaultProps.onChange).toHaveBeenCalledWith('Hello');
  });
  
  it('shows grapheme counter', () => {
    render(<TextInput {...defaultProps} graphemeCount={50} />);
    const counter = screen.getByTestId('char-counter');
    expect(counter).toHaveTextContent('50');
    expect(counter).toHaveTextContent('1 000');
  });
  
  it('shows warning state when in warning zone', () => {
    render(<TextInput {...defaultProps} graphemeCount={900} isWarningZone />);
    const counter = screen.getByTestId('char-counter');
    expect(counter).toHaveClass('warning');
    expect(counter).toHaveTextContent('900');
    expect(counter).toHaveTextContent('1 000');
  });
  
  it('shows error state when over limit', () => {
    render(<TextInput {...defaultProps} graphemeCount={1001} isOverLimit />);
    const counter = screen.getByTestId('char-counter');
    expect(counter).toHaveClass('error');
    expect(counter).toHaveTextContent('1001');
    expect(counter).toHaveTextContent('1 000');
  });
  
  // Мікрофон існує лише тоді, коли є `voice`: розгортання без STT-ключа або
  // клієнт без MediaRecorder не показують вимкнену кнопку, а не показують нічого.
  it('renders no microphone without the voice prop', () => {
    render(<TextInput {...defaultProps} />);
    expect(screen.queryByTestId('mic-button')).not.toBeInTheDocument();
  });

  it('renders the microphone when voice input is available', () => {
    render(<TextInput {...defaultProps} voice={voice('idle')} />);
    expect(screen.getByLabelText('Записати голосом')).toBeInTheDocument();
    expect(screen.getByTestId('mic-button')).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onToggle when the microphone is clicked', () => {
    render(<TextInput {...defaultProps} voice={voice('idle')} />);
    fireEvent.click(screen.getByTestId('mic-button'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  // Відлік іде вгору й тільки в секундах: стеля 30 с, тому хвилин тут не буває.
  it('shows the elapsed seconds, the meter and a pressed toggle while recording', () => {
    render(<TextInput {...defaultProps} voice={voice('recording', 3)} />);
    const micButton = screen.getByTestId('mic-button');
    expect(micButton).toHaveClass('is-recording');
    expect(micButton).toHaveAttribute('aria-pressed', 'true');
    expect(micButton).toHaveAccessibleName('Зупинити запис');
    expect(micButton).toHaveTextContent('03');
    expect(screen.getByTestId('voice-meter')).toBeInTheDocument();
  });

  // Рядок запису забирає ширину в «Випадкової фрази», а не переносить її на
  // другий рядок: підпис згортається, кубики лишаються.
  it('collapses the random phrase label while the recorder holds the row', () => {
    const { rerender } = render(<TextInput {...defaultProps} voice={voice('idle')} />);
    expect(screen.getByLabelText('Вставити випадкову фразу')).not.toHaveClass('is-collapsed');

    rerender(<TextInput {...defaultProps} voice={voice('recording', 1)} />);
    expect(screen.getByLabelText('Вставити випадкову фразу')).toHaveClass('is-collapsed');
  });

  // Без цієї кнопки єдиним способом не надіслати сказане було дочекатися
  // тридцятої секунди.
  it('offers cancelling instead of clearing while recording', () => {
    render(<TextInput {...defaultProps} value="Якийсь текст" voice={voice('recording', 2)} />);
    expect(screen.queryByLabelText('Очистити')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('cancel-recording-button'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(defaultProps.onChange).not.toHaveBeenCalled();
  });

  it('shows no cancel button outside a recording', () => {
    render(<TextInput {...defaultProps} value="Якийсь текст" voice={voice('idle')} />);
    expect(screen.queryByTestId('cancel-recording-button')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Очистити')).toBeInTheDocument();
  });

  // Запис мусить бути зупинним навіть на межі ліміту символів - інакше мікрофон
  // лишається відкритим, а кнопка вимкненою.
  it('keeps the microphone clickable at the grapheme limit while recording', () => {
    render(<TextInput {...defaultProps} graphemeCount={1000} voice={voice('recording', 5)} />);
    expect(screen.getByTestId('mic-button')).toBeEnabled();
  });

  it('disables the microphone at the grapheme limit when idle', () => {
    render(<TextInput {...defaultProps} graphemeCount={1000} voice={voice('idle')} />);
    expect(screen.getByTestId('mic-button')).toBeDisabled();
  });

  it('disables the microphone while the transcript is on its way', () => {
    render(<TextInput {...defaultProps} voice={voice('processing')} />);
    const micButton = screen.getByTestId('mic-button');
    expect(micButton).toBeDisabled();
    expect(micButton).toHaveAccessibleName('Розпізнаю мову');
    // Пігулка лишається розгорнутою до транскрипту, тому «Випадкова фраза»
    // ще згорнута, а шкали вже немає: мікрофон закритий.
    expect(micButton).toHaveClass('is-processing');
    expect(screen.queryByTestId('voice-meter')).not.toBeInTheDocument();
  });

  it('calls onRandomPhrase when random phrase button clicked', () => {
    render(<TextInput {...defaultProps} />);
    fireEvent.click(screen.getByLabelText('Вставити випадкову фразу'));
    expect(defaultProps.onRandomPhrase).toHaveBeenCalled();
  });
  
  it('shows clear button when value exists', () => {
    render(<TextInput {...defaultProps} value="Some text" />);
    const clearButton = screen.getByLabelText('Очистити');
    expect(clearButton).toBeInTheDocument();
  });
  
  it('clears text when clear button clicked', () => {
    render(<TextInput {...defaultProps} value="Some text" />);
    const clearButton = screen.getByLabelText('Очистити');
    fireEvent.click(clearButton);
    expect(defaultProps.onChange).toHaveBeenCalledWith('');
  });
  
  it('prevents newline on Enter key', () => {
    render(<TextInput {...defaultProps} />);
    const textarea = screen.getByPlaceholderText('Test placeholder');
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    // The handler prevents default, so value should not change
    expect(defaultProps.onChange).not.toHaveBeenCalled();
  });
  
  it('applies over-limit class when isOverLimit', () => {
    render(<TextInput {...defaultProps} isOverLimit />);
    const wrapperEl = screen.getByRole('textbox').closest('.text-input-wrapper');
    expect(wrapperEl).toHaveClass('over-limit');
  });
  
  it('applies warning-zone class when isWarningZone', () => {
    render(<TextInput {...defaultProps} isWarningZone />);
    const wrapperEl = screen.getByRole('textbox').closest('.text-input-wrapper');
    expect(wrapperEl).toHaveClass('warning-zone');
  });
});
