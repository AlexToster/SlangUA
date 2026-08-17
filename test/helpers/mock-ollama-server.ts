import { createServer, Server, IncomingMessage, ServerResponse } from 'http';
import { parse } from 'url';

interface MockOllamaConfig {
  shouldFail: boolean;
  failAfterCalls?: number;
  customResponse?: string;
}

interface MockOllamaServer {
  url: string;
  close: () => Promise<void>;
}

let server: Server | null = null;
let callCount = 0;
let config: MockOllamaConfig = { shouldFail: false };

const DEFAULT_RESPONSES: Record<string, string> = {
  GEN_Z: 'no cap Test text fr fr 💀',
  STREET: 'yo Test text fam',
  IT_SLANG: 'Test text // TODO: fix this lol',
  POFENI: 'Базар по поняттях: Test text.',
  KANCLER: 'Уважаемый пользователь, Test text. С уважением, администрация.',
  GALICIAN: 'Прошу пана, Test text, борше і файно.',
};

// The Style Engine never puts the style id into the prompt, and the "Avoid"
// section of several prompts cross-references OTHER style ids, so matching on
// ids picks the wrong style. Match a phrase that is unique to each style's
// Voice line instead (verified against src/style-engine/styles/*/prompt.md).
const STYLE_MARKERS: ReadonlyArray<readonly [string, string]> = [
  ['GEN_Z', 'молодь, що живе в інтернеті'],
  ['STREET', 'школу життя'],
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
 */
function generateOpenAIResponse(style: string, sourceText: string = 'Test text'): string {
  const template = DEFAULT_RESPONSES[style] || DEFAULT_RESPONSES.GEN_Z;
  const content = template.replace('Test text', sourceText);
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
 * Body handling for the chat endpoint: failure injection, source-text
 * extraction and style detection.
 */
function handleChatRequest(
  req: IncomingMessage,
  res: ServerResponse,
  render: (style: string, sourceText: string) => string
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
      const lastMessage = messages[messages.length - 1]?.content || '';

      // Extract style from the system prompt or user message
      let sourceText = 'Test text';

      // Try to extract source text from the message
      const textMatch = lastMessage.match(/Translate this text: "([^"]+)"/);
      if (textMatch) {
        sourceText = textMatch[1];
      }

      const style = detectStyle(messages);

      const response = config.customResponse || render(style, sourceText);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(response);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid request', code: 'INVALID_REQUEST' }));
    }
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
  } else if (parsedUrl.pathname === '/__admin/reset' && req.method === 'POST') {
    callCount = 0;
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
