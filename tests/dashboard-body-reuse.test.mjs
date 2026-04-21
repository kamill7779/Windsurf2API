import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function createMockResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(chunk = '') {
      this.body += String(chunk);
    },
  };
}

test('handleDashboardRoutes reuses parsedBody for POST requests that were already read upstream', async () => {
  const originalCwd = process.cwd();
  const originalAdminPassword = process.env.ADMIN_PASSWORD;
  const sandboxDir = mkdtempSync(join(tmpdir(), 'w2a-dashboard-test-'));

  try {
    process.chdir(sandboxDir);
    process.env.ADMIN_PASSWORD = 'test-admin';

    const dashboardUrl = new URL('../dist/routes/dashboard.js', import.meta.url);
    dashboardUrl.searchParams.set('t', String(Date.now()));
    const { handleDashboardRoutes } = await import(dashboardUrl.href);

    const req = {
      method: 'POST',
      headers: { 'x-admin-password': 'test-admin' },
      parsedBody: {
        name: 'parsed-body-token',
        totalQuota: 0,
        allowedModels: [],
      },
    };
    const res = createMockResponse();

    const handled = await handleDashboardRoutes(req, res, '/dashboard/tokens');
    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);

    const payload = JSON.parse(res.body);
    assert.equal(payload.success, true);
    assert.equal(payload.token.name, 'parsed-body-token');
    assert.ok(existsSync(join(sandboxDir, 'data', 'tokens.json')));
  } finally {
    process.chdir(originalCwd);
    if (originalAdminPassword === undefined) {
      delete process.env.ADMIN_PASSWORD;
    } else {
      process.env.ADMIN_PASSWORD = originalAdminPassword;
    }
  }
});
