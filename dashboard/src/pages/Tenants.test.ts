// Render test for the Tenants page (multi-tenancy, admin + unscoped only) on the Webhooks.test.ts
// harness. GET /tenants needs an unscoped admin key: a 403 must show the "not available" permission
// state, not an empty "no tenants" list. Create posts { name }, and delete is refused (409) while any
// key or session still references the tenant — the row must stay and the failure must surface.
import '../test-helpers/register-hooks.ts';
import { test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let tenantsStatus = 200;
let tenantList: unknown[] = [];
let createCalls = 0;
let createBody: Record<string, unknown> | undefined;
let deleteCalls: string[] = [];
let deleteStatus = 204;

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function installFetchStub(): void {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    if (init?.method === 'POST' && path === '/api/tenants') {
      createCalls++;
      createBody = JSON.parse(String(init.body));
      return Promise.resolve(jsonResponse({ id: 't-new', name: createBody!.name, externalId: null, isActive: true }, 201));
    }
    if (init?.method === 'DELETE' && /^\/api\/tenants\/[^/]+$/.test(path)) {
      deleteCalls.push(path);
      return deleteStatus === 204
        ? Promise.resolve(new Response(null, { status: 204 }))
        : Promise.resolve(jsonResponse({ message: 'Tenant still has keys or sessions bound to it.' }, deleteStatus));
    }
    if (path === '/api/tenants') {
      if (tenantsStatus === 403) return Promise.resolve(jsonResponse({ message: 'An unscoped admin key is required.' }, 403));
      if (tenantsStatus !== 200) return Promise.resolve(jsonResponse({ message: 'database offline' }, 500));
      return Promise.resolve(jsonResponse(tenantList));
    }
    return Promise.resolve(jsonResponse({ message: `unstubbed ${path}` }, 404));
  }) as typeof fetch;
}

let rtl: typeof import('@testing-library/react');
let Tenants: (typeof import('./Tenants.tsx'))['Tenants'];
let RoleProvider: (typeof import('../components/RoleProvider.tsx'))['RoleProvider'];
let ToastProvider: (typeof import('../components/Toast.tsx'))['ToastProvider'];
let queryClient: QueryClient | undefined;

before(async () => {
  const { installJsdomGlobals } = await import('../test-helpers/jsdom.ts');
  await installJsdomGlobals();
  installFetchStub();
  window.sessionStorage.setItem('openwa_user_role', 'admin');
  window.sessionStorage.setItem('openwa_api_key', 'test-key');
  const { i18nReady } = await import('../i18n/index.ts');
  await i18nReady;
  rtl = await import('@testing-library/react');
  ({ RoleProvider } = await import('../components/RoleProvider.tsx'));
  ({ ToastProvider } = await import('../components/Toast.tsx'));
  ({ Tenants } = await import('./Tenants.tsx'));
});

afterEach(() => {
  rtl.cleanup();
  queryClient?.clear();
  queryClient = undefined;
  tenantsStatus = 200;
  tenantList = [];
  createCalls = 0;
  createBody = undefined;
  deleteCalls = [];
  deleteStatus = 204;
});

function renderTenants(): void {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 1_000 } } });
  rtl.render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(RoleProvider, null, createElement(ToastProvider, null, createElement(Tenants))),
    ),
  );
}

test('lists the tenants', async () => {
  tenantList = [
    { id: 't1', name: 'Acme Corp', externalId: 'wh_ws_1', isActive: true, createdAt: '2026-11-01T00:00:00.000Z' },
    { id: 't2', name: 'Globex', externalId: null, isActive: false, createdAt: '2026-11-02T00:00:00.000Z' },
  ];
  renderTenants();
  await rtl.screen.findByText('Acme Corp');
  await rtl.screen.findByText('Globex');
  await rtl.screen.findByText('wh_ws_1');
});

test('an empty list shows the empty state, not an error', async () => {
  renderTenants();
  await rtl.screen.findByText('No tenants yet');
});

test('a 403 shows the permission state, not an empty list', async () => {
  tenantsStatus = 403;
  renderTenants();
  await rtl.screen.findByText('Not available for this key');
  assert.ok(!rtl.screen.queryByText('No tenants yet'), 'a refused read claimed there are no tenants');
});

test('creating a tenant posts the name', async () => {
  const { screen, fireEvent, waitFor } = rtl;
  renderTenants();
  fireEvent.click(await screen.findByRole('button', { name: 'Create tenant' }));
  const name = await screen.findByLabelText('Name');
  fireEvent.change(name, { target: { value: 'New Tenant' } });
  fireEvent.click(await screen.findByRole('button', { name: /^Create$/ }));
  await waitFor(() => assert.equal(createCalls, 1));
  assert.equal(createBody?.name, 'New Tenant');
});

test('a delete refused with 409 keeps the row and does not claim the list is empty', async () => {
  tenantList = [{ id: 't1', name: 'Acme Corp', externalId: null, isActive: true, createdAt: '2026-11-01T00:00:00.000Z' }];
  deleteStatus = 409;
  const { screen, fireEvent, waitFor } = rtl;
  renderTenants();
  await screen.findByText('Acme Corp');
  fireEvent.click(screen.getByTitle('Delete'));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(rtl.within(dialog).getByRole('button', { name: /^Delete$/ }));
  await waitFor(() => assert.equal(deleteCalls.length, 1));
  // The tenant is still listed: the refused delete removed nothing.
  await screen.findByText('Acme Corp');
});
