/**
 * Devin authentication — REST API login, no Puppeteer needed.
 */

import https from 'https';

const DEVIN_LOGIN_URL = 'https://windsurf.com/_devin-auth/password/login';
const WINDSURF_POSTAUTH_URL = 'https://windsurf.com/_backend/exa.seat_management_pb.SeatManagementService/WindsurfPostAuth';

function postJson(url: string, body: object): Promise<{ status: number; data: any }> {
  return new Promise((resolve) => {
    const postData = JSON.stringify(body);
    const req = https.request({
      hostname: new URL(url).hostname,
      port: 443,
      path: new URL(url).pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://windsurf.com/',
        'Origin': 'https://windsurf.com',
      },
      timeout: 15000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode || 0, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode || 0, data: null });
        }
      });
    });
    req.on('error', () => resolve({ status: 0, data: null }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, data: null }); });
    req.write(postData);
    req.end();
  });
}

/**
 * Login with email+password → get devin_session_token.
 */
export async function devinLogin(email: string, password: string): Promise<{ sessionToken: string; auth1Token: string; accountId: string }> {
  // Step 1: Get auth1 token
  const loginRes = await postJson(DEVIN_LOGIN_URL, { email, password });
  if (loginRes.status !== 200 || !loginRes.data?.token) {
    throw new Error(`Devin login failed: ${loginRes.status} ${JSON.stringify(loginRes.data)}`);
  }
  const auth1Token: string = loginRes.data.token;

  // Step 2: Exchange for session token
  const postAuthRes = await postJson(WINDSURF_POSTAUTH_URL, { auth1_token: auth1Token });
  if (postAuthRes.status !== 200 || !postAuthRes.data?.sessionToken) {
    throw new Error(`WindsurfPostAuth failed: ${postAuthRes.status} ${JSON.stringify(postAuthRes.data)}`);
  }

  return {
    sessionToken: postAuthRes.data.sessionToken,
    auth1Token: postAuthRes.data.auth1Token,
    accountId: postAuthRes.data.accountId,
  };
}
