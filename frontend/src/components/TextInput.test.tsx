import { render, screen, fireEvent } from '@testing-library/react';
import { TextInput } from './TextInput';

describe('TextInput', () => {
  const defaultProps = {
    value: '',
    onChange: vi.fn(),
    onPaste: vi.fn(),
    onRandomPhrase: vi.fn(),
    isRandomPhraseDisabled: false,
    graphemeCount: 0,
    maxGraphemes: 1000,
    isWarningZone: false,
    isOverLimit: false,
    placeholder: 'Test placeholder',
  };

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
  
  it('renders paste button', () => {
    render(<TextInput {...defaultProps} />);
    const pasteButton = screen.getByLabelText('Вставити з буфера обміну');
    expect(pasteButton).toBeInTheDocument();
  });
  
  it('calls onPaste when paste button clicked', () => {
    render(<TextInput {...defaultProps} />);
    const pasteButton = screen.getByLabelText('Вставити з буфера обміну');
    fireEvent.click(pasteButton);
    expect(defaultProps.onPaste).toHaveBeenCalled();
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
  
  it('disables paste button when at max graphemes', () => {
    render(<TextInput {...defaultProps} graphemeCount={1000} />);
    const pasteButton = screen.getByLabelText('Вставити з буфера обміну');
    expect(pasteButton).toBeDisabled();
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
