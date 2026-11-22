import { apiKeyAuthorizationFingerprint, apiKeyExpiryTime } from './api-key-authorization';
import { ApiKeyRole } from './entities/api-key.entity';

describe('apiKeyExpiryTime', () => {
  it.each([null, undefined])('reads %s as no expiry', value => {
    expect(apiKeyExpiryTime(value)).toBeNull();
  });

  it.each([new Date(123_456), '1970-01-01T00:02:03.456Z'])('reads the instant of %s', value => {
    expect(apiKeyExpiryTime(value)).toBe(123_456);
  });

  // REST refuses a key whose stored expiry is an Invalid Date (validateApiKey), so the socket sweep that
  // reads the same value must not mistake it for a key that never expires.
  it.each([new Date('not-a-date'), 'not-a-date'])('reads the unparseable expiry %s as already expired', value => {
    expect(apiKeyExpiryTime(value)).toBe(0);
  });
});

describe('apiKeyAuthorizationFingerprint', () => {
  const unscoped = {
    role: ApiKeyRole.OPERATOR,
    allowedIps: null,
    allowedSessions: null,
    allowedChats: null,
    tenantId: null,
  };

  it('tells an unparseable expiry from no expiry', () => {
    const open = apiKeyAuthorizationFingerprint({ ...unscoped, expiresAt: null });
    const broken = apiKeyAuthorizationFingerprint({ ...unscoped, expiresAt: new Date('not-a-date') });
    expect(open).toBe('["operator",null,null,null,null,null]');
    expect(broken).toBe('["operator",null,null,null,0,null]');
  });

  // Confining a key to a tenant (or detaching it) changes what it may reach, so the fingerprint must
  // move — otherwise the operator path and the socket sweep would leave a reassigned key's live
  // sockets streaming a tenant it no longer belongs to.
  it('changes when a key is confined to a tenant', () => {
    const global = apiKeyAuthorizationFingerprint({ ...unscoped, expiresAt: null, tenantId: null });
    const tenant = apiKeyAuthorizationFingerprint({ ...unscoped, expiresAt: null, tenantId: 'tenant-A' });
    expect(tenant).not.toBe(global);
    expect(tenant).toBe('["operator",null,null,null,null,"tenant-A"]');
  });

  it('distinguishes two different tenants', () => {
    const a = apiKeyAuthorizationFingerprint({ ...unscoped, expiresAt: null, tenantId: 'tenant-A' });
    const b = apiKeyAuthorizationFingerprint({ ...unscoped, expiresAt: null, tenantId: 'tenant-B' });
    expect(a).not.toBe(b);
  });

  // '' is what the create/update stamp collapses a blank tenant to; it must read identically to NULL so
  // a legacy/blank row does not look like a change and needlessly evict sockets.
  it('reads an empty-string tenantId as no tenant (same as NULL)', () => {
    const blank = apiKeyAuthorizationFingerprint({ ...unscoped, expiresAt: null, tenantId: '' });
    const nul = apiKeyAuthorizationFingerprint({ ...unscoped, expiresAt: null, tenantId: null });
    expect(blank).toBe(nul);
  });
});
