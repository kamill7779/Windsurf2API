/**
 * OpenAI-compatible API routes
 * /v1/chat/completions
 * /v1/models
 */

import http from 'http';
import { URL } from 'url';
import { listModels, listAnthropicModels } from '../models.js';
import { handleChatCompletion, handleResponse } from '../services/chat.js';
import { handleAnthropicMessage } from '../services/anthropic.js';
import { hasActiveChannels } from '../services/channel.js';
import { isLsReady } from '../core/langserver.js';

function json(res: http.ServerResponse, status: number, body: object) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(body));
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const parsed = (req as any).parsedBody;
  if (parsed) return JSON.stringify(parsed);
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function getAuthKey(req: http.IncomingMessage): string | null {
  const auth = req.headers['authorization'] || '';
  const m = String(auth).match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

export async function handleApiRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  path: string
): Promise<boolean> {
  const method = req.method || 'GET';

  if (path === '/v1/models' && method === 'GET') {
    const userAgent = String(req.headers['user-agent'] || '');
    if (userAgent.startsWith('claude-cli')) {
      json(res, 200, listAnthropicModels());
    } else {
      json(res, 200, { object: 'list', data: listModels() });
    }
    return true;
  }

  if (path === '/v1/chat/completions' && method === 'POST') {
    if (!isLsReady()) {
      json(res, 503, { error: 'Language server not ready' });
      return true;
    }
    if (!hasActiveChannels()) {
      json(res, 503, { error: 'No active channels. Add a channel via dashboard first.' });
      return true;
    }

    const authKey = getAuthKey(req);
    if (!authKey) {
      json(res, 401, { error: 'Missing Authorization header. Use: Bearer sk-xxx' });
      return true;
    }

    let body: any;
    try { body = JSON.parse(await readBody(req)); }
    catch { json(res, 400, { error: 'Invalid JSON' }); return true; }

    await handleChatCompletion(req, res, body, authKey);
    return true;
  }

  if (path === '/v1/responses' && method === 'POST') {
    if (!isLsReady()) {
      json(res, 503, { error: 'Language server not ready' });
      return true;
    }
    if (!hasActiveChannels()) {
      json(res, 503, { error: 'No active channels. Add a channel via dashboard first.' });
      return true;
    }

    const authKey = getAuthKey(req);
    if (!authKey) {
      json(res, 401, { error: 'Missing Authorization header. Use: Bearer sk-xxx' });
      return true;
    }

    let body: any;
    try { body = JSON.parse(await readBody(req)); }
    catch { json(res, 400, { error: 'Invalid JSON' }); return true; }

    await handleResponse(req, res, body, authKey);
    return true;
  }

  if (path === '/v1/messages' && method === 'POST') {
    if (!isLsReady()) {
      json(res, 503, { error: 'Language server not ready' });
      return true;
    }
    if (!hasActiveChannels()) {
      json(res, 503, { error: 'No active channels. Add a channel via dashboard first.' });
      return true;
    }

    let body: any;
    try { body = JSON.parse(await readBody(req)); }
    catch { json(res, 400, { error: 'Invalid JSON' }); return true; }

    await handleAnthropicMessage(req, res, body);
    return true;
  }

  return false;
}
