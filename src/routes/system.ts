/**
 * System routes — health, dashboard static files
 */

import http from 'http';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getCsrfToken, getLsPort, isLsReady } from '../core/langserver.js';
import { config } from '../config.js';
import { submitBashToolResult } from '../services/modes/native-bridge/tool-bridge.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function json(res: http.ServerResponse, status: number, body: object) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(body));
}

function html(res: http.ServerResponse, status: number, body: string) {
  res.writeHead(status, {
    'Content-Type': 'text/html',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function checkInternalAuth(req: http.IncomingMessage): boolean {
  const adminPw = config.adminPassword || '';
  if (!adminPw) return true;
  const pw = String(req.headers['x-admin-password'] || '');
  return pw === adminPw;
}

export async function handleSystemRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  path: string
): Promise<boolean> {
  const method = req.method || 'GET';

  if (path === '/health' && method === 'GET') {
    json(res, 200, { status: 'ok', lsReady: isLsReady() });
    return true;
  }

  if (path === '/internal/tool-results' && method === 'POST') {
    if (!checkInternalAuth(req)) {
      json(res, 401, { error: 'Unauthorized' });
      return true;
    }

    const body = (req as any).parsedBody || {};
    if (!body || body.tool !== 'Bash') {
      json(res, 400, { error: 'Only tool=Bash is currently supported' });
      return true;
    }
    if (!body.bridgeId || !body.toolCallId) {
      json(res, 400, { error: 'bridgeId and toolCallId are required' });
      return true;
    }

    const replay = await submitBashToolResult({
      payload: {
        bridgeId: String(body.bridgeId),
        toolCallId: String(body.toolCallId),
        stdout: body.stdout == null ? '' : String(body.stdout),
        stderr: body.stderr == null ? '' : String(body.stderr),
        exitCode: body.exitCode == null ? undefined : Number(body.exitCode),
        success: body.success == null ? undefined : !!body.success,
      },
      port: getLsPort(),
      csrfToken: getCsrfToken(),
    });

    json(res, replay.accepted ? 200 : 500, replay);
    return true;
  }

  // Dashboard SPA — serve index.html
  if ((path === '/dashboard' || path === '/dashboard/') && method === 'GET') {
    try {
      const dashboardPath = resolve(__dirname, '../dashboard/index.html');
      const content = readFileSync(dashboardPath, 'utf-8');
      html(res, 200, content);
    } catch (e: any) {
      html(res, 500, `<h1>Dashboard not found</h1><p>${e.message}</p>`);
    }
    return true;
  }

  return false;
}
