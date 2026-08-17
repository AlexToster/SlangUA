interface TelegramWebApp {
  ready(): void;
  expand(): void;
  switchInlineQuery(query: string, chooseChatTypes?: ('users' | 'bots' | 'groups' | 'channels')[]): void;
  /**
   * Opens a t.me link inside Telegram. Optional: older clients (and the jsdom
   * test stub) do not provide it, so every call site must feature-detect.
   */
  openTelegramLink?(url: string): void;
  close(): void;
  readTextFromClipboard(callback: (text: string | null) => void): void;
  initData: string;
  MainButton: {
    setText(text: string): void;
    onClick(callback: () => void): void;
    offClick(callback: () => void): void;
    show(): void;
    hide(): void;
    enable(): void;
    disable(): void;
    setParams(params: { color?: string; textColor?: string }): void;
    isVisible: boolean;
    isActive: boolean;
  };
  BackButton: {
    onClick(callback: () => void): void;
    offClick(callback: () => void): void;
    show(): void;
    hide(): void;
    isVisible: boolean;
  };
  HapticFeedback: {
    impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
    notificationOccurred(type: 'error' | 'success' | 'warning'): void;
    selectionChanged(): void;
  };
  themeParams: Record<string, string>;
  safeAreaInset: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
  onEvent(event: string, callback: () => void): void;
  offEvent(event: string, callback: () => void): void;
  viewportHeight: number;
  viewportStableHeight: number;
  headerColor: string;
  backgroundColor: string;
  isExpanded: boolean;
  isClosingConfirmationEnabled: boolean;
}

interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
}

interface LaunchParams {
  initData: string;
  initDataRaw: string;
  startParam?: string;
  themeParams: Record<string, string>;
  tgWebAppPlatform: string;
  tgWebAppVersion: string;
  version: string;
  user?: TelegramUser;
  chat?: any;
  chat_type?: string;
  chat_instance?: string;
}

interface Window {
  Telegram: {
    WebApp: TelegramWebApp;
  };
}

declare function isTMA(): boolean;
declare function initTelegram(): void;
declare function retrieveLaunchParams(): LaunchParams;
declare function restoreInitData(): string | void;
