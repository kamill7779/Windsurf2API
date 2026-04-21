/**
 * HTTP server — route dispatcher
 */

import http from 'http';
import { log } from './config.js';
import { handleApiRoutes } from './routes/api.js';
import { handleDashboardRoutes } from './routes/dashboard.js';
import { handleSystemRoutes } from './routes/system.js';

export function startServer(port: number): http.Server {
  const server = http.createServer(async (req, res) => {
    try {
      const method = req.method || 'GET';
      const path = req.url?.split('?')[0] || '/';

      // DEBUG: log all incoming requests; parse body once and attach to req
      let bodyStr = '';
      if (method === 'POST') {
        const chunks: Buffer[] = [];
        req.on('data', c => chunks.push(c));
        await new Promise<void>(resolve => req.on('end', () => {
          bodyStr = Buffer.concat(chunks).toString('utf-8');
          resolve();
        }));
        try {
          const body = JSON.parse(bodyStr);
          (req as any).parsedBody = body;
          console.log(`[REQ] ${method} ${path} model=${body.model || 'none'} tools=${body.tools ? body.tools.length : 0}`);
        } catch {
          console.log(`[REQ] ${method} ${path} body=${bodyStr.slice(0, 200)}`);
        }
      }

      // CORS preflight
      if (method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, DELETE, PATCH, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Password',
        });
        return res.end();
      }

      // Try routes in order
      if (await handleSystemRoutes(req, res, path)) return;
      if (await handleApiRoutes(req, res, path)) return;
      if (await handleDashboardRoutes(req, res, path)) return;

      // 404
      res.writeHead(404, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify({ error: `${method} ${path} not found` }));
    } catch (err: any) {
      log.error('Handler error:', err.message);
      if (!res.headersSent) {
        res.writeHead(500, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    }
  });

  server.listen(port, '0.0.0.0', () => {
    log.info(`Server on http://0.0.0.0:${port}`);
    log.info('  POST /v1/chat/completions  (Authorization: Bearer sk-xxx)');
    log.info('  GET  /v1/models');
    log.info('  GET  /dashboard             (Admin UI)');
    log.info('  GET  /dashboard/overview');
    log.info('  GET  /dashboard/channels');
    log.info('  GET  /dashboard/tokens');
    log.info('  GET  /health');
  });

  return server;
}
