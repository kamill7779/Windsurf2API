/**
 * Dashboard management API routes
 * /dashboard/*
 */

import http from 'http';
import { log, config } from '../config.js';
import {
  listChannels, addChannel, removeChannel, updateChannelStatus, getChannelById,
} from '../services/channel.js';
import {
  listTokens, createToken, removeToken, updateToken,
} from '../services/token.js';
import { getStats, getTodayRequests } from '../services/stats.js';
import { devinLogin } from '../core/login.js';
import { hasActiveChannels } from '../services/channel.js';
import { isLsReady } from '../core/langserver.js';

function json(res: http.ServerResponse, status: number, body: object) {
  res.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  });
  res.end(JSON.stringify(body));
}

async function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf-8');
        resolve(text ? JSON.parse(text) : {});
      } catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

function checkAdminAuth(req: http.IncomingMessage): boolean {
  const pw = req.headers['x-admin-password'] || '';
  const adminPw = config.adminPassword || '';
  if (!adminPw) return true; // No password set = open
  return pw === adminPw;
}

export async function handleDashboardRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  path: string
): Promise<boolean> {
  const method = req.method || 'GET';

  if (!path.startsWith('/dashboard')) return false;

  // Auth check
  if (!checkAdminAuth(req)) {
    json(res, 401, { error: 'Unauthorized' });
    return true;
  }

  const subPath = path.slice('/dashboard'.length) || '/';

  // ─── Overview ───
  if (subPath === '/overview' && method === 'GET') {
    json(res, 200, {
      channelCount: listChannels().length,
      activeChannelCount: listChannels().filter(c => c.status === 'active').length,
      tokenCount: listTokens().length,
      todayRequests: getTodayRequests(),
      lsReady: isLsReady(),
      hasChannels: hasActiveChannels(),
    });
    return true;
  }

  // ─── Channels ───
  if (subPath === '/channels' && method === 'GET') {
    json(res, 200, { channels: listChannels() });
    return true;
  }

  if (subPath === '/channels' && method === 'POST') {
    const body = await readBody(req);
    // Method 1: email + password login
    if (body.email && body.password) {
      try {
        const { sessionToken } = await devinLogin(body.email, body.password);
        const ch = addChannel(body.email, sessionToken);
        json(res, 200, { success: true, channel: { id: ch.id, email: ch.email } });
        return true;
      } catch (err: any) {
        json(res, 401, { error: err.message });
        return true;
      }
    }
    // Method 2: direct apiKey
    if (body.apiKey) {
      const ch = addChannel(body.email || `key-${body.apiKey.slice(0, 8)}`, body.apiKey);
      json(res, 200, { success: true, channel: { id: ch.id, email: ch.email } });
      return true;
    }
    json(res, 400, { error: 'Provide email+password or apiKey' });
    return true;
  }

  const channelProbeMatch = subPath.match(/^\/channels\/([^\/]+)\/probe$/);
  if (channelProbeMatch && method === 'POST') {
    const id = channelProbeMatch[1];
    const ch = getChannelById(id);
    if (!ch) return json(res, 404, { error: 'Channel not found' }), true;
    // Simple probe: just check if we can instantiate a client
    json(res, 200, { success: true, status: ch.status, message: 'Channel exists' });
    return true;
  }

  const channelPatchMatch = subPath.match(/^\/channels\/([^\/]+)$/);
  if (channelPatchMatch && method === 'PATCH') {
    const id = channelPatchMatch[1];
    const body = await readBody(req);
    if (body.status) {
      const ok = updateChannelStatus(id, body.status);
      json(res, ok ? 200 : 404, { success: ok });
      return true;
    }
    json(res, 400, { error: 'No valid fields to update' });
    return true;
  }

  const channelDeleteMatch = subPath.match(/^\/channels\/([^\/]+)$/);
  if (channelDeleteMatch && method === 'DELETE') {
    const id = channelDeleteMatch[1];
    const ok = removeChannel(id);
    json(res, ok ? 200 : 404, { success: ok });
    return true;
  }

  // ─── Tokens ───
  if (subPath === '/tokens' && method === 'GET') {
    json(res, 200, { tokens: listTokens() });
    return true;
  }

  if (subPath === '/tokens' && method === 'POST') {
    const body = await readBody(req);
    const token = createToken(body.name, body.totalQuota, body.allowedModels);
    json(res, 200, { success: true, token });
    return true;
  }

  const tokenPatchMatch = subPath.match(/^\/tokens\/([^\/]+)$/);
  if (tokenPatchMatch && method === 'PATCH') {
    const id = tokenPatchMatch[1];
    const body = await readBody(req);
    const ok = updateToken(id, body);
    json(res, ok ? 200 : 404, { success: ok });
    return true;
  }

  const tokenDeleteMatch = subPath.match(/^\/tokens\/([^\/]+)$/);
  if (tokenDeleteMatch && method === 'DELETE') {
    const id = tokenDeleteMatch[1];
    const ok = removeToken(id);
    json(res, ok ? 200 : 404, { success: ok });
    return true;
  }

  // ─── Stats ───
  if (subPath === '/stats' && method === 'GET') {
    json(res, 200, getStats());
    return true;
  }

  // ─── Models ───
  if (subPath === '/models' && method === 'GET') {
    const { MODELS } = await import('../models.js');
    json(res, 200, {
      models: Object.entries(MODELS).map(([id, info]) => ({
        id, ...info,
      })),
    });
    return true;
  }

  return false;
}
