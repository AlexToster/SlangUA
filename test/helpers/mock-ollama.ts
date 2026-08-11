import { createServer, Server, IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';

interface MockOllamaConfig {
  shouldFail: boolean;
  failAfterCalls?: number;
  customResponse?: string;
}

let server: Server | null = null;
let callCount = 0;
let config: MockOllamaConfig = { shouldFail: false };

const DEFAULT_RESPONSES: Record<string, string> = {
  GEN_Z: 'Крінж, це просто вайб! 😎 База, братан.',
  STREET: 'Че кажеш, кент? Базарь нормально, а то по базару гуляешь.',
  IT_SLANG: 'Деплой прошёл успешно. Функционал задеплоен, баги пофикшены.',
  POFENI: 'Слушай сюда, фраер. По понятиям так не делают, зашквар.',
  KANCLER: 'В соответствии с вышеизложенным, прошу предоставить исчерпывающий ответ в установленный срок.',
};

function generateOllamaResponse(style: string): string {
  const content = DEFAULT_RESPONSES[style] || DEFAULT_RESPONSES.GEN_Z;
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
  const url = new URL(req.url || '', `http://${req.headers.host}`);

  if (url.pathname === '/api/chat' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      callCount++;

      // Check if we should fail
      if (config.shouldFail && (!config.failAfterCalls || callCount >= config.failAfterCalls)) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Service unavailable' }));
        return;
      }

      try {
        const parsed = JSON.parse(body);
        const messages = parsed.messages || [];
        const lastMessage = messages[messages.length - 1]?.content || '';

        // Extract style from the system prompt or user message
        let style = 'GEN_Z';
        for (const msg of messages) {
          if (msg.role === 'system' && msg.content) {
            if (msg.content.includes('GEN_Z') || msg.content.includes('Gen Z')) style = 'GEN_Z';
            else if (msg.content.includes('STREET')) style = 'STREET';
            else if (msg.content.includes('IT_SLANG') || msg.content.includes('IT Slang')) style = 'IT_SLANG';
            else if (msg.content.includes('POFENI')) style = 'POFENI';
            else if (msg.content.includes('KANCLER')) style = 'KANCLER';
          }
        }

        const response = config.customResponse || generateOllamaResponse(style);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(response);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request' }));
      }
    });
  } else if (url.pathname === '/api/tags' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      models: [{ name: 'test-model', size: 1000000, digest: 'test', details: {} }],
    }));
  } else if (url.pathname === '/api/version' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ version: '0.1.0' }));
  } else if (url.pathname === '/__admin/reset' && req.method === 'POST') {
    callCount = 0;
    config = { shouldFail: false };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  } else if (url.pathname === '/__admin/config' && req.method === 'POST') {
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

export async function startMockOllama(): Promise<string> {
  return new Promise((resolve, reject) => {
    server = createServer(handleRequest);
    server.listen(0, 'localhost', () => {
      const address = server!.address();
      if (address && typeof address === 'object') {
        const url = `http://localhost:${address.port}`;
        console.log(`[Mock Ollama] Started at ${url}`);
        resolve(url);
      } else {
        reject(new Error('Failed to get server address'));
      }
    });
    server.on('error', reject);
  });
}

export async function stopMockOllama(): Promise<void> {
  if (server) {
    return new Promise((resolve) => {
      server!.close(() => {
        server = null;
        callCount = 0;
        config = { shouldFail: false };
        console.log('[Mock Ollama] Stopped');
        resolve();
      });
    });
  }
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