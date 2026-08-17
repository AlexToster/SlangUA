import axios, { AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import type {
  AuthTokens,
  UserProfile,
  Style,
  PreviewResult,
  Translation,
  HistoryResponse,
  SaveFromPreviewResult,
  InlineShareResult,
  ShareSource,
  ApiError,
  SlangStyle,
  FavoriteUpdate,
} from '../types/api';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api/v1';

class ApiService {
  private client: AxiosInstance;
  private accessToken: string | null = null;
  private refreshPromise: Promise<string> | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      headers: {
        'Content-Type': 'application/json',
      },
      withCredentials: true,
    });

    this.client.interceptors.request.use((config: InternalAxiosRequestConfig) => {
      if (this.accessToken && config.headers) {
        config.headers.Authorization = `Bearer ${this.accessToken}`;
      }
      return config;
    });

    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError<ApiError>) => {
        const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

        if (error.response?.status === 401 && !originalRequest._retry && this.accessToken) {
          originalRequest._retry = true;

          try {
            const newAccessToken = await this.refreshAccessToken();
            if (originalRequest.headers) {
              originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
            }
            return this.client(originalRequest);
          } catch {
            this.clearTokens();
            window.location.reload();
            return Promise.reject(error);
          }
        }

        return Promise.reject(error);
      }
    );
  }

  setTokens(tokens: AuthTokens) {
    this.accessToken = tokens.accessToken;
  }

  clearTokens() {
    this.accessToken = null;
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  isAuthenticated(): boolean {
    return !!this.accessToken;
  }

  private async refreshAccessToken(): Promise<string> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
      try {
        const response = await axios.post<AuthTokens>(`${API_BASE_URL}/auth/refresh`, {}, {
          withCredentials: true,
          headers: { 'X-CSRF-Token': this.csrfToken() },
        });
        this.accessToken = response.data.accessToken;
        return response.data.accessToken;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  private csrfToken(): string {
    const cookie = document.cookie.split('; ').find((entry) => entry.startsWith('slangua_csrf='));
    return cookie ? decodeURIComponent(cookie.slice('slangua_csrf='.length)) : '';
  }

  // Auth
  async authenticateWithTelegram(initData: string): Promise<AuthTokens> {
    const response = await this.client.post<AuthTokens>('/auth/telegram', { initData });
    this.setTokens(response.data);
    return response.data;
  }

  async logout(): Promise<void> {
    await this.client.post('/auth/logout');
    this.clearTokens();
  }

  // User
  async getProfile(): Promise<UserProfile> {
    const response = await this.client.get<UserProfile>('/user/me');
    return response.data;
  }

  async updateProfile(data: Partial<Omit<Pick<UserProfile, 'defaultSlangStyle' | 'notificationsEnabled' | 'ageConfirmedAdult'>, 'defaultSlangStyle'>> & { defaultSlangStyle?: SlangStyle | null }): Promise<UserProfile> {
    const response = await this.client.patch<UserProfile>('/user/me', data);
    return response.data;
  }

  // Styles
  async getStyles(): Promise<Style[]> {
    const response = await this.client.get<Style[]>('/styles');
    return response.data;
  }

  // Translate
  async translatePreview(text: string, style: SlangStyle, signal?: AbortSignal): Promise<PreviewResult> {
    const response = await this.client.post<PreviewResult>('/translate/preview', { text, style }, { signal });
    return response.data;
  }

  async saveFromPreview(previewId: string): Promise<SaveFromPreviewResult> {
    const response = await this.client.post<SaveFromPreviewResult>('/translate/save', { previewId });
    return response.data;
  }

  async createInlineShare(source: ShareSource): Promise<InlineShareResult> {
    const response = await this.client.post<InlineShareResult>('/share/inline', source);
    return response.data;
  }

  async translateDirect(text: string, style: SlangStyle): Promise<Translation> {
    const response = await this.client.post<Translation>('/translate', { text, style });
    return response.data;
  }

  // History
  async getHistory(params?: { cursor?: string; limit?: number; favorite?: boolean; search?: string }): Promise<HistoryResponse> {
    // Drop undefined entries so an inactive filter never reaches the query string.
    const query = Object.fromEntries(
      Object.entries(params ?? {}).filter(([, value]) => value !== undefined)
    );
    const response = await this.client.get<HistoryResponse>('/history', { params: query });
    return response.data;
  }

  async setFavorite(id: number, favorite: boolean): Promise<Translation> {
    const body: FavoriteUpdate = { favorite };
    const response = await this.client.patch<Translation>(`/history/${id}/favorite`, body);
    return response.data;
  }

  async deleteTranslation(id: number): Promise<void> {
    await this.client.delete(`/history/${id}`);
  }

  /** Removes every saved translation of the current user. Idempotent. */
  async clearHistory(): Promise<{ deletedCount: number }> {
    const response = await this.client.delete<{ deletedCount: number }>('/history');
    return response.data;
  }
}

export const apiService = new ApiService();
