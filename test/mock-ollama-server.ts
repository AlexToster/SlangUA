/**
 * Mock Ollama HTTP Server
 *
 * Mimics the Ollama /api/chat endpoint so the real OllamaAdapter
 * can hit it during manual testing. No production code is modified.
 *
 * Usage: npx tsx test/mock-ollama-server.ts
 * (then in another terminal: curl ... as before)
 */

import http from 'http';

const PORT = 11434;

const server = http.createServer((req: http.IncomingMessage, res: http.ServerResponse) => {
  // Only handle POST /api/chat
  if (req.method !== 'POST' || req.url !== '/api/chat') {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  let body = '';
  req.on('data', (chunk: Buffer) => {
    body += chunk.toString();
  });
  req.on('end', () => {
    try {
      const { model, messages, options } = JSON.parse(body);

      // Extract the system prompt to detect which style is being used
      const systemMsg = messages.find((m: any) => m.role === 'system')?.content || '';
      const userMsg = messages.find((m: any) => m.role === 'user')?.content || '';

      let translatedText: string;

      // Detect style from distinctive phrases in each style's prompt.md.
      // These keywords appear ONLY in the respective style's system prompt.
      if (systemMsg.includes('TikTok-генерація') || systemMsg.includes('Discord-спільноти')) {
        translatedText = translateGenZ(userMsg);
      } else if (systemMsg.includes('по-тюремному') || systemMsg.includes('зоново-бандитську')) {
        translatedText = translatePofeni(userMsg);
      } else if (systemMsg.includes('на дворах і в районі')) {
        translatedText = translateStreet(userMsg);
      } else if (systemMsg.includes('код-рев\'ю') || systemMsg.includes('стендапах')) {
        translatedText = translateITSlang(userMsg);
      } else if (systemMsg.includes('канцелярист') || systemMsg.includes('вищезазначеного')) {
        translatedText = translateKancler(userMsg);
      } else {
        translatedText = `[${model}] ${userMsg}`;
      }

      // Ollama /api/chat response format
      const response = {
        model,
        created_at: new Date().toISOString(),
        message: { role: 'assistant', content: translatedText },
        done: true,
        done_reason: 'stop',
        total_duration: 1000000,
        load_duration: 500000,
        prompt_eval_count: userMsg.length,
        eval_count: translatedText.length,
      };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
    } catch (err) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Invalid request' }));
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🟢 Mock Ollama server listening on http://0.0.0.0:${PORT}`);
});

// ── Style-specific translators ──────────────────────────────────────

function translateGenZ(text: string): string {
  // Roughly the same length as input (0.8-1.3x)
  const targetLen = Math.round(text.length);
  const prefixes = ['йоу', 'бро', 'кеп', 'реально'];
  const suffixes = ['лол', 'крінж', 'імбово', 'база'];
  const words = text.split(/\s+/).filter(Boolean);

  if (words.length === 0) return '';

  let result = '';
  let i = 0;
  while (result.length < targetLen) {
    const w = words[i % words.length];
    const p = prefixes[(i * 2) % prefixes.length];
    const s = suffixes[(i * 3 + 1) % suffixes.length];
    const token = `${p} ${w}, ${s} `;
    if (result.length + token.length > targetLen * 1.3) break;
    result += token;
    i++;
    if (i > 100) break; // safety
  }

  return result.trim() + '.';
}

function translateStreet(text: string): string {
  return `Слухай сюди, братан. "${text}" — це тема, розрулюється по життю. Без обману, все чітко.`;
}

function translateITSlang(text: string): string {
  return `[DEPLOY]: ${text}\n[STATUS]: 200 OK\n[COMMIT]: feat(translation): implement slang transformation\n[REVIEW]: LGTM ✅`;
}

function translatePofeni(text: string): string {
  return `Пане, дозвольте звернутися. Ваше прохання: "${text}" — буде виконано з належною пошаною. Маю честь.`;
}

function translateKancler(text: string): string {
  // 2-4x longer than input, ratio-driven, no forced header/footer
  const targetLen = Math.round(text.length * (2 + Math.random() * 2)); // 2-4x
  const prefixes = [
    'вищезазначений',
    'згаданий у контексті',
    'відповідний',
    'релевантний',
    'зафіксований у реєстрі',
  ];
  const words = text.split(/\s+/).filter(Boolean);
  const cleanWords = words.map(w => w.replace(/[.!?]+$/, ''));
  if (cleanWords.length === 0) return '';

  let result = '';
  let i = 0;
  while (result.length < targetLen) {
    const w = cleanWords[i % cleanWords.length];
    const p = prefixes[i % prefixes.length];
    const token = `${p} ${w}, `;
    if (result.length + token.length > targetLen) break;
    result += token;
    i++;
    if (i > 100) break; // safety
  }
  // Ensure output is at least 2x even if the first token was skipped by the guard
  if (result.length < text.length * 2) {
    result = cleanWords.map((w, idx) => `${prefixes[idx % prefixes.length]} ${w}`).join(', ') + ', ';
  }

  return `У зв'язку з викладеним, повідомляю: ${result.trim().replace(/,$/, '')}.`;
}
