/**
 * Anthropic Messages API compatibility layer.
 * The entrypoint resolves auth/model state and delegates request handling to the configured bridge mode.
 */

import http from 'http';

import { log } from '../config.js';
import { resolveModel } from '../models.js';
import { ChatError } from './chat.js';
import { handleAnthropicMessageByConfiguredMode } from './bridge-mode-router.js';

function json(res: http.ServerResponse, status: number, body: object) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(body));
}

function getApiKey(req: http.IncomingMessage): string | null {
  const xApiKey = req.headers['x-api-key'];
  if (xApiKey) return String(xApiKey);
  const auth = req.headers['authorization'] || '';
  const m = String(auth).match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

export async function handleAnthropicMessage(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  body: any,
): Promise<void> {
  try {
    const authKey = getApiKey(req);
    if (!authKey) {
      return json(res, 401, {
        type: 'error',
        error: { type: 'authentication_error', message: 'Missing x-api-key header' },
      });
    }

    const modelKey = resolveModel(body.model);
    if (!modelKey) {
      return json(res, 404, {
        type: 'error',
        error: { type: 'not_found_error', message: `Model "${body.model}" not found` },
      });
    }

    await handleAnthropicMessageByConfiguredMode({
      req,
      res,
      body,
      authKey,
      modelKey,
    });
  } catch (err: any) {
    if (err instanceof ChatError) {
      json(res, err.statusCode, {
        type: 'error',
        error: {
          type: err.statusCode === 401 ? 'authentication_error' :
                err.statusCode === 429 ? 'rate_limit_error' : 'api_error',
          message: err.message,
        },
      });
    } else {
      log.error('Anthropic API error:', err.message);
      json(res, 500, {
        type: 'error',
        error: { type: 'api_error', message: err.message },
      });
    }
  }
}
