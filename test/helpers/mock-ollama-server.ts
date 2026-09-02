import { createServer, Server, IncomingMessage, ServerResponse } from 'http';
import { parse } from 'url';

interface MockOllamaConfig {
  shouldFail: boolean;
  failAfterCalls?: number;
  customResponse?: string;
  /**
   * Force `/v1/audio/transcriptions` to answer with this status instead of a
   * transcript. Used to exercise key rotation and the exhausted-quota path;
   * `shouldFail` above belongs to the chat endpoint and is left alone.
   */
  sttFailStatus?: number;
  /** Transcript to return. An empty string is a valid answer: silence. */
  sttText?: string;
}

interface MockOllamaServer {
  url: string;
  close: () => Promise<void>;
}

/** What the mock saw in the last multipart upload, for assertions. */
export interface SttRequestInfo {
  filename: string | null;
  fileContentType: string | null;
  model: string | null;
  language: string | null;
  authorization: string | null;
  bytes: number;
}

let server: Server | null = null;
let callCount = 0;
let sttCallCount = 0;
let lastSttRequest: SttRequestInfo | null = null;
let config: MockOllamaConfig = { shouldFail: false };

/**
 * What the chat mock answers, per style. Exported on purpose: a test that wants
 * to prove the right prompt was resolved must compare against this map, never
 * quote a word out of it. These strings are rewritten whenever the Style
 * Engine's language assets are refreshed, and a literal copied into an
 * assertion then fails with the application behaving correctly.
 */
export const DEFAULT_RESPONSES: Readonly<Record<string, string>> = {
  GEN_Z: 'Test text — чиста база, без рофлу.',
  STREET: 'Test text, без понтів.',
  IT_SLANG: 'Test text: треба дебажити.',
  POFENI: 'Test text — за базар відповідаю.',
  KANCLER: 'Беручи до уваги Test text, повідомляємо про його розгляд.',
  GALICIAN: 'Прошу пана, Test text — фест файний.',
};

// The Style Engine never puts the style id into the prompt, and the "Avoid"
// section of several prompts cross-references OTHER style ids, so matching on
// ids picks the wrong style. Match a phrase that is unique to each style's
// Voice line instead (verified against src/style-engine/styles/*/prompt.md).
const STYLE_MARKERS: ReadonlyArray<readonly [string, string]> = [
  ['GEN_Z', 'молодь, що живе в інтернеті'],
  ['STREET', 'міського розмовного стилю'],
  ['IT_SLANG', 'український розробник'],
  ['POFENI', 'тюремної говірки'],
  ['KANCLER', 'канцелярист, бюрократ'],
  ['GALICIAN', 'мешканець Галичини'],
];

export function detectStyle(messages: Array<{ role?: string; content?: string }>): string {
  for (const message of messages) {
    const content = message?.content;
    if (message?.role !== 'system' || !content) continue;
    const match = STYLE_MARKERS.find(([, marker]) => content.includes(marker));
    if (match) return match[0];
  }
  return 'GEN_Z';
}

/**
 * Response in the OpenAI Chat Completions shape. Every provider now speaks this
 * format through OpenAICompatibleAdapter (Ollama included, via its `/v1`
 * endpoint), so this mock only serves `/v1/chat/completions`; the native Ollama
 * routes went away with OllamaAdapter.
 *
 * The answer deliberately does not echo the requested text. Both adapters send
 * `request.text` bare as the user message (`openai-compatible.adapter.ts`,
 * `claude.adapter.ts`) - there is no `Translate this text: "..."` wrapper to
 * parse it back out of, so this used to substitute a value that was never
 * found. The fixtures carry a literal `Test text` instead. A test that needs to
 * prove the user's text reached the provider has to capture the request, the
 * way `getLastSttRequest()` does for transcriptions; the chat endpoint keeps no
 * such record today.
 */
function generateOpenAIResponse(style: string): string {
  const content = DEFAULT_RESPONSES[style] || DEFAULT_RESPONSES.GEN_Z;
  return JSON.stringify({
    id: 'chatcmpl-mock',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'test-model',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 30,
    },
  });
}

/**
 * Body handling for the chat endpoint: failure injection and style detection.
 */
function handleChatRequest(
  req: IncomingMessage,
  res: ServerResponse,
  render: (style: string) => string
) {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => {
    callCount++;

    // Check if we should fail
    if (config.shouldFail && (!config.failAfterCalls || callCount >= config.failAfterCalls)) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Service unavailable', code: 'AI_PROVIDER_UNAVAILABLE' }));
      return;
    }

    try {
      const parsed = JSON.parse(body);
      const messages = parsed.messages || [];
      const style = detectStyle(messages);

      const response = config.customResponse || render(style);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(response);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid request', code: 'INVALID_REQUEST' }));
    }
  });
}

/**
 * OpenAI-compatible `/v1/audio/transcriptions`.
 *
 * The body is multipart, but nothing here needs a real parser: the fields the
 * tests assert on (the uploaded filename and its content type, the model, the
 * language) are read off the raw payload, which also keeps this helper free of
 * a multipart dependency. The audio bytes themselves are counted and dropped.
 */
function handleTranscriptionRequest(req: IncomingMessage, res: ServerResponse) {
  const chunks: Buffer[] = [];
  req.on('data', (chunk) => {
    chunks.push(Buffer.from(chunk));
  });
  req.on('end', () => {
    sttCallCount++;
    const raw = Buffer.concat(chunks);
    // Headers, not audio: decoding the whole payload as latin1 keeps the byte
    // count honest while still matching the ASCII part boundaries.
    const text = raw.toString('latin1');

    const field = (name: string) =>
      text.match(new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)`))?.[1] ?? null;

    lastSttRequest = {
      filename: text.match(/filename="([^"]*)"/)?.[1] ?? null,
      fileContentType: text.match(/filename="[^"]*"\r\nContent-Type: ([^\r]+)/)?.[1] ?? null,
      model: field('model'),
      language: field('language'),
      authorization: (req.headers['authorization'] as string | undefined) ?? null,
      bytes: raw.length,
    };

    if (config.sttFailStatus) {
      res.writeHead(config.sttFailStatus, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: {
          message: config.sttFailStatus === 429
            ? 'Rate limit reached for model whisper-large-v3-turbo'
            : 'Mock transcription failure',
          type: 'mock_error',
        },
      }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ text: config.sttText ?? 'привіт, як ся маєш' }));
  });
}

function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const parsedUrl = parse(req.url || '', true);

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (parsedUrl.pathname === '/v1/chat/completions' && req.method === 'POST') {
    handleChatRequest(req, res, generateOpenAIResponse);
  } else if (parsedUrl.pathname === '/v1/audio/transcriptions' && req.method === 'POST') {
    handleTranscriptionRequest(req, res);
  } else if (parsedUrl.pathname === '/__admin/reset' && req.method === 'POST') {
    callCount = 0;
    sttCallCount = 0;
    lastSttRequest = null;
    config = { shouldFail: false };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  } else if (parsedUrl.pathname === '/__admin/config' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        config = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid config' }));
      }
    });
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }
}

export async function mockOllamaServer(port: number = 0): Promise<MockOllamaServer> {
  return new Promise((resolve, reject) => {
    server = createServer(handleRequest);
    server.listen(port, '127.0.0.1', () => {
      const address = server!.address();
      if (address && typeof address === 'object') {
        const url = `http://127.0.0.1:${address.port}`;
        console.log(`[Mock Ollama] Started at ${url}`);
        resolve({
          url,
          close: () => new Promise<void>((resolveClose) => {
            server!.close(() => {
              server = null;
              callCount = 0;
              sttCallCount = 0;
              lastSttRequest = null;
              config = { shouldFail: false };
              resolveClose();
            });
          }),
        });
      } else {
        reject(new Error('Failed to get server address'));
      }
    });
    server.on('error', reject);
  });
}

export function setMockConfig(newConfig: Partial<MockOllamaConfig>): void {
  config = { ...config, ...newConfig };
}

export function getMockConfig(): MockOllamaConfig {
  return { ...config };
}

export function getCallCount(): number {
  return callCount;
}

export function resetCallCount(): void {
  callCount = 0;
}

/** Transcription calls served since the last reset - proves rotation happened. */
export function getSttCallCount(): number {
  return sttCallCount;
}

export function resetSttState(): void {
  sttCallCount = 0;
  lastSttRequest = null;
}

export function getLastSttRequest(): SttRequestInfo | null {
  return lastSttRequest ? { ...lastSttRequest } : null;
}
