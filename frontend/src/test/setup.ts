import '@testing-library/jest-dom';
import { vi } from 'vitest';

console.log('Test setup loaded');

// Mock Intl.Segmenter for grapheme counting - use a proper constructor
class MockSegmenter {
  constructor() {}
  segment(text: string) {
    return Array.from(text).map(char => ({ segment: char, isWordLike: true }));
  }
}

if (typeof globalThis.Intl !== 'undefined') {
  Object.defineProperty(globalThis.Intl, 'Segmenter', {
    value: MockSegmenter,
    writable: true,
    configurable: true,
  });
}

// Mock navigator.clipboard
Object.defineProperty(navigator, 'clipboard', {
  value: {
    readText: vi.fn(() => Promise.resolve('')),
    writeText: vi.fn(() => Promise.resolve()),
  },
  writable: true,
});

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  value: vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })),
  writable: true,
});

// Mock ResizeObserver
globalThis.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock Telegram WebApp
Object.defineProperty(window, 'Telegram', {
  value: {
    WebApp: {
      initData: '',
      initDataUnsafe: {},
      version: '8.0',
      platform: 'tdesktop',
      colorScheme: 'light',
      themeParams: {
        bg_color: '#ffffff',
        text_color: '#000000',
        hint_color: '#999999',
        link_color: '#2481cc',
        button_color: '#2481cc',
        button_text_color: '#ffffff',
        secondary_bg_color: '#f0f0f0',
      },
      isExpanded: true,
      viewportHeight: window.innerHeight,
      viewportStableHeight: window.innerHeight,
      headerColor: '#ffffff',
      backgroundColor: '#ffffff',
      isClosingConfirmationEnabled: false,
      BackButton: { isVisible: false, onClick: vi.fn(), show: vi.fn(), hide: vi.fn() },
      MainButton: { isVisible: false, isActive: false, isProgressVisible: false, setText: vi.fn(), onClick: vi.fn(), show: vi.fn(), hide: vi.fn(), enable: vi.fn(), disable: vi.fn(), showProgress: vi.fn(), hideProgress: vi.fn() },
      HapticFeedback: { impactOccurred: vi.fn(), notificationOccurred: vi.fn(), selectionChanged: vi.fn() },
      CloudStorage: { setItem: vi.fn(), getItem: vi.fn(), getKeys: vi.fn(), removeItem: vi.fn() },
      BiometricManager: { isInited: false, isBiometricAvailable: false, init: vi.fn(), requestAccess: vi.fn(), authenticate: vi.fn() },
      SettingsButton: { isVisible: false, onClick: vi.fn(), show: vi.fn(), hide: vi.fn() },
      onEvent: vi.fn(),
      offEvent: vi.fn(),
      sendData: vi.fn(),
      openTelegramLink: vi.fn(),
      openInvoice: vi.fn(),
      showPopup: vi.fn(),
      showScanQrPopup: vi.fn(),
      closeScanQrPopup: vi.fn(),
      readTextFromClipboard: vi.fn(),
      ready: vi.fn(),
      expand: vi.fn(),
      close: vi.fn(),
    },
  },
  writable: true,
});