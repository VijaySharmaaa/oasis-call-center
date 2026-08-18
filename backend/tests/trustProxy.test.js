/**
 * Proxy trust.
 *
 * Getting this wrong fails quietly in both directions, which is why it is
 * pinned here rather than left to a deployment note:
 *
 *   too low  — express-rate-limit throws ERR_ERL_UNEXPECTED_X_FORWARDED_FOR
 *              and every user shares one bucket, so real traffic gets 429s
 *   too high — a client forges X-Forwarded-For and picks its own bucket,
 *              which removes rate limiting altogether
 */
process.env.JWT_SECRET = 'test-secret';

const express = require('express');
const request = require('supertest');

/** Build an app the way server.js does, for a given TRUST_PROXY / NODE_ENV. */
function appWith({ trustProxy, nodeEnv = 'production' }) {
  const isProd = nodeEnv === 'production';
  const app = express();

  const setting = trustProxy ?? (isProd ? '1' : '0');
  if (setting !== '0' && setting !== 'false') {
    const hops = Number(setting);
    app.set('trust proxy', Number.isFinite(hops) ? hops : setting);
  }

  app.get('/whoami', (req, res) => res.json({ ip: req.ip, trust: app.get('trust proxy') }));
  return app;
}

describe('trust proxy', () => {
  it('reads the real client IP through one proxy hop', async () => {
    const app = appWith({ trustProxy: '1' });
    // Nginx appends the client, so the header is "<client>" for a single hop.
    const res = await request(app).get('/whoami').set('X-Forwarded-For', '203.0.113.9');
    expect(res.body.ip).toBe('203.0.113.9');
  });

  it('sees through two hops when a load balancer fronts the proxy', async () => {
    const app = appWith({ trustProxy: '2' });
    // "<client>, <lb>" — with 2 hops trusted, the client is the leftmost.
    const res = await request(app).get('/whoami').set('X-Forwarded-For', '203.0.113.9, 10.0.0.7');
    expect(res.body.ip).toBe('203.0.113.9');
  });

  it('does NOT believe a forged hop beyond the configured count', async () => {
    const app = appWith({ trustProxy: '1' });
    // A client claiming an extra upstream must not get to choose its bucket:
    // with one hop trusted, the rightmost entry is what Express takes.
    const res = await request(app).get('/whoami').set('X-Forwarded-For', '1.2.3.4, 203.0.113.9');
    expect(res.body.ip).toBe('203.0.113.9');
    expect(res.body.ip).not.toBe('1.2.3.4');
  });

  it('ignores the header entirely when no proxy is configured', async () => {
    const app = appWith({ trustProxy: '0' });
    const res = await request(app).get('/whoami').set('X-Forwarded-For', '203.0.113.9');
    expect(res.body.ip).not.toBe('203.0.113.9');
  });

  it('defaults to one hop in production — the docker-compose topology', async () => {
    const app = appWith({ trustProxy: undefined, nodeEnv: 'production' });
    expect(app.get('trust proxy')).toBe(1);
  });

  it('defaults to trusting nothing outside production', async () => {
    const app = appWith({ trustProxy: undefined, nodeEnv: 'development' });
    expect(app.get('trust proxy')).toBeFalsy();
  });

  it('accepts "false" as a way to switch it off', async () => {
    const app = appWith({ trustProxy: 'false' });
    expect(app.get('trust proxy')).toBeFalsy();
  });

  it('passes a non-numeric value through, so a CIDR or "loopback" still works', async () => {
    const app = appWith({ trustProxy: 'loopback' });
    expect(app.get('trust proxy')).toBe('loopback');
  });
});
