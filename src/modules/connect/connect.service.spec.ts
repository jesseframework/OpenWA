import { BadRequestException } from '@nestjs/common';
import { ConnectService } from './connect.service';
import { ApiKeyRole } from '../auth/entities/api-key.entity';

const ENV = {
  WORKHUB_SIGNIN_ENABLED: 'true',
  WORKHUB_API_URL: 'https://api.wh.test',
  BASE_URL: 'https://openwa.test',
};

describe('ConnectService', () => {
  let auth: { createApiKey: jest.Mock };
  let tenants: { findOrCreateByExternalId: jest.Mock };
  let svc: ConnectService;
  const origEnv = process.env;
  const origFetch = global.fetch;

  beforeEach(() => {
    process.env = { ...origEnv, ...ENV };
    auth = { createApiKey: jest.fn().mockResolvedValue({ apiKey: { id: 'k1' }, rawKey: 'owa_k1_minted' }) };
    tenants = { findOrCreateByExternalId: jest.fn().mockResolvedValue({ id: 'tenant-A' }) };
    svc = new ConnectService(auth as never, tenants as never);
  });

  afterEach(() => {
    process.env = origEnv;
    global.fetch = origFetch;
    jest.restoreAllMocks();
  });

  it('is enabled from its config', () => {
    expect(svc.enabled).toBe(true);
  });

  it('startFlow builds an S256 authorize URL and remembers the state', () => {
    const { authorizeUrl, state } = svc.startFlow();
    const u = new URL(authorizeUrl);
    expect(u.origin + u.pathname).toBe('https://api.wh.test/v1/public/connect/authorize');
    expect(u.searchParams.get('client_id')).toBe('openwa');
    expect(u.searchParams.get('redirect_uri')).toBe('https://openwa.test/api/connect/callback');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(u.searchParams.get('state')).toBe(state);
    expect(state.length).toBeGreaterThan(20);
  });

  it('exchanges the code, provisions the tenant, mints a tenant-scoped key, and hands it off once', async () => {
    const { state } = svc.startFlow();
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ access_token: 'whc_tok' }) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ tenantId: 'wh-co-1', tenantName: 'Acme', user: { email: 'ava@acme.test' } }),
      });
    global.fetch = fetchMock as never;

    const handoff = await svc.handleCallback('whcc_code', state);

    const calls = fetchMock.mock.calls as Array<[string, { body?: URLSearchParams; headers?: Record<string, string> }]>;
    // token exchange: the stored verifier + the EXACT /api-prefixed redirect
    expect(calls[0][0]).toBe('https://api.wh.test/v1/public/connect/token');
    const body = calls[0][1].body as URLSearchParams;
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('whcc_code');
    expect(body.get('redirect_uri')).toBe('https://openwa.test/api/connect/callback');
    expect(body.get('code_verifier')).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/);
    // /connect/me with the bearer
    expect(calls[1][0]).toBe('https://api.wh.test/v1/connect/me');
    expect(calls[1][1].headers?.authorization).toBe('Bearer whc_tok');
    // company → tenant, then a tenant-scoped operator key named for the person
    expect(tenants.findOrCreateByExternalId).toHaveBeenCalledWith('wh-co-1', 'Acme');
    expect(auth.createApiKey).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-A', role: ApiKeyRole.OPERATOR, name: 'WorkHub · ava@acme.test' }),
    );
    // the handoff redeems exactly once
    expect(svc.claim(handoff)).toBe('owa_k1_minted');
    expect(svc.claim(handoff)).toBeNull();
  });

  it('refuses an unknown state, and refuses a state reused after it was consumed', async () => {
    await expect(svc.handleCallback('c', 'never-issued')).rejects.toBeInstanceOf(BadRequestException);

    const { state } = svc.startFlow();
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ access_token: 't' }) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ tenantId: 'c', tenantName: 'C', user: {} }),
      }) as never;
    await svc.handleCallback('c', state); // consumes the state
    await expect(svc.handleCallback('c', state)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('surfaces a failed token exchange as BadRequest (and never mints a key)', async () => {
    const { state } = svc.startFlow();
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 400, json: () => Promise.resolve({}) }) as never;
    await expect(svc.handleCallback('c', state)).rejects.toBeInstanceOf(BadRequestException);
    expect(auth.createApiKey).not.toHaveBeenCalled();
  });

  it('surfaces an incomplete /connect/me (no tenant) as BadRequest', async () => {
    const { state } = svc.startFlow();
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ access_token: 't' }) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ user: { email: 'x@y.z' } }),
      }) as never;
    await expect(svc.handleCallback('c', state)).rejects.toBeInstanceOf(BadRequestException);
    expect(auth.createApiKey).not.toHaveBeenCalled();
  });

  it('claim returns null for an unknown or empty handoff', () => {
    expect(svc.claim('nope')).toBeNull();
    expect(svc.claim('')).toBeNull();
  });
});
