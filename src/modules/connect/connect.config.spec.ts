import { computeConnectConfig, connectRedirectUri } from './connect.config';
import { ApiKeyRole } from '../auth/entities/api-key.entity';

const base = {
  WORKHUB_SIGNIN_ENABLED: 'true',
  WORKHUB_API_URL: 'https://api.wh.test/',
  BASE_URL: 'https://openwa.test/',
} as NodeJS.ProcessEnv;

describe('connect config', () => {
  it('is enabled only with the flag AND both the WorkHub and own base set', () => {
    expect(computeConnectConfig(base).enabled).toBe(true);
    expect(computeConnectConfig({ ...base, WORKHUB_SIGNIN_ENABLED: 'false' }).enabled).toBe(false);
    expect(computeConnectConfig({ ...base, WORKHUB_SIGNIN_ENABLED: undefined }).enabled).toBe(false);
    expect(computeConnectConfig({ ...base, WORKHUB_API_URL: '' }).enabled).toBe(false);
    expect(computeConnectConfig({ ...base, BASE_URL: '' }).enabled).toBe(false);
  });

  it('trims trailing slashes and builds the /api-prefixed callback', () => {
    const c = computeConnectConfig(base);
    expect(c.apiUrl).toBe('https://api.wh.test');
    expect(c.baseUrl).toBe('https://openwa.test');
    // Must match migration 306's registered redirect byte-for-byte, including the /api prefix.
    expect(connectRedirectUri(c)).toBe('https://openwa.test/api/connect/callback');
  });

  it('defaults client id openwa, role operator, and a 12h key ttl', () => {
    const c = computeConnectConfig(base);
    expect(c.clientId).toBe('openwa');
    expect(c.signInRole).toBe(ApiKeyRole.OPERATOR);
    expect(c.keyTtlMinutes).toBe(720);
  });

  it('honours an explicit client id and a valid role, and clamps a silly ttl', () => {
    expect(computeConnectConfig({ ...base, WORKHUB_CONNECT_CLIENT_ID: 'openwa-staging' }).clientId).toBe(
      'openwa-staging',
    );
    expect(computeConnectConfig({ ...base, WORKHUB_SIGNIN_ROLE: 'admin' }).signInRole).toBe(ApiKeyRole.ADMIN);
    expect(computeConnectConfig({ ...base, WORKHUB_SIGNIN_ROLE: 'viewer' }).signInRole).toBe(ApiKeyRole.VIEWER);
    // An unknown role falls back to operator (never silently grants admin).
    expect(computeConnectConfig({ ...base, WORKHUB_SIGNIN_ROLE: 'superuser' }).signInRole).toBe(ApiKeyRole.OPERATOR);
    expect(computeConnectConfig({ ...base, WORKHUB_SIGNIN_KEY_TTL_MINUTES: '120' }).keyTtlMinutes).toBe(120);
    expect(computeConnectConfig({ ...base, WORKHUB_SIGNIN_KEY_TTL_MINUTES: '1' }).keyTtlMinutes).toBe(720); // below min → default
    expect(computeConnectConfig({ ...base, WORKHUB_SIGNIN_KEY_TTL_MINUTES: '999999' }).keyTtlMinutes).toBe(720); // above max → default
    expect(computeConnectConfig({ ...base, WORKHUB_SIGNIN_KEY_TTL_MINUTES: 'NaN' }).keyTtlMinutes).toBe(720);
  });
});
