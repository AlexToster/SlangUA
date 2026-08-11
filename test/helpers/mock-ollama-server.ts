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
  POFENI: 'блин, Test text вообще топ',
  KANCLER: 'Уважаемый пользователь, Test text. С уважением, администрация.',
};

function generateOllamaResponse(style: string, sourceText: string = 'Test text'): string {
  const template = DEFAULT_RESPONSES[style] || DEFAULT_RESPONSES.GEN_Z;
  const content = template.replace('Test text', sourceText);
  return JSON.stringify({
    model: 'test-model',
    created_at: new Date().toISOString(),
    message: {
      role: 'assistant',
      content,
    },
    done: true,
  });
}

function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const parsedUrl = parse(req.url || '', true);

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (parsedUrl.pathname === '/api/chat' && req.method === 'POST') {
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
        let style = 'GEN_Z';
        let sourceText = 'Test text';
        
        // Try to extract source text from the message
        const textMatch = lastMessage.match(/Translate this text: "([^"]+)"/);
        if (textMatch) {
          sourceText = textMatch[1];
        }

        for (const msg of messages) {
          if (msg.role === 'system' && msg.content) {
            if (msg.content.includes('GEN_Z') || msg.content.includes('Gen Z')) style = 'GEN_Z';
            else if (msg.content.includes('STREET')) style = 'STREET';
            else if (msg.content.includes('IT_SLANG') || msg.content.includes('IT Slang')) style = 'IT_SLANG';
            else if (msg.content.includes('POFENI')) style = 'POFENI';
            else if (msg.content.includes('KANCLER')) style = 'KANCLER';
          }
        }

        const response = config.customResponse || generateOllamaResponse(style, sourceText);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(response);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request', code: 'INVALID_REQUEST' }));
      }
    });
  } else if (parsedUrl.pathname === '/api/tags' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      models: [{ name: 'test-model', size: 1000000, digest: 'test', details: {} }],
    }));
  } else if (parsedUrl.pathname === '/api/version' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ version: '0.1.0' }));
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
