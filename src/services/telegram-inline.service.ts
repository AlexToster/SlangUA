import { config } from '../config/index.js';
import { sharePayloadService } from './share-payload.service.js';

interface InlineQuery { id: string; from: { id: number }; query: string; }

export class TelegramInlineService {
  private async answerInlineQuery(inlineQueryId: string, results: unknown[]) {
    const response = await fetch(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/answerInlineQuery`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ inline_query_id: inlineQueryId, results, cache_time: 0, is_personal: true }),
    });
    if (!response.ok) throw new Error(`Telegram answerInlineQuery failed with ${response.status}`);
  }

  async handleInlineQuery(query: InlineQuery): Promise<void> {
    const match = /^s_([0-9a-f-]{36})$/i.exec(query.query.trim());
    if (!match) return this.answerInlineQuery(query.id, []);
    const payload = await sharePayloadService.get(match[1], String(query.from.id));
    if (!payload) return this.answerInlineQuery(query.id, []);
    await this.answerInlineQuery(query.id, [{
      type: 'article', id: match[1], title: `SlangUA · ${payload.style}`,
      input_message_content: { message_text: `SlangUA · ${payload.style}\n\n${payload.translatedText}` },
    }]);
  }
}

export const telegramInlineService = new TelegramInlineService();
