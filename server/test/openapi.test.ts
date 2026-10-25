import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { openApiDocument } from '../src/app.js';

describe('OpenAPI contract', () => {
  const doc = openApiDocument();

  it('describes GET /health and the shared schemas', () => {
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.paths?.['/health']?.get).toBeDefined();
    expect(Object.keys(doc.components?.schemas ?? {})).toEqual(
      expect.arrayContaining(['ErrorCode', 'ErrorResponse', 'HealthResponse']),
    );
  });

  it('describes sign-in and GET /v1/me, with bearer auth where needed', () => {
    expect(doc.paths?.['/v1/auth/otp/request']?.post).toBeDefined();
    expect(doc.paths?.['/v1/auth/otp/verify']?.post).toBeDefined();
    expect(doc.paths?.['/v1/auth/refresh']?.post).toBeDefined();
    expect(doc.paths?.['/v1/auth/logout']?.post?.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.paths?.['/v1/me']?.get?.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.components?.securitySchemes?.bearerAuth).toEqual({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' });
    expect(Object.keys(doc.components?.schemas ?? {})).toEqual(
      expect.arrayContaining(['AuthResponse', 'Me', 'OtpRequest', 'OtpVerifyRequest', 'RefreshRequest', 'Role']),
    );
  });

  it('describes the family and super admin routes, all behind bearer auth', () => {
    const routes: Array<[string, 'get' | 'post' | 'patch' | 'put' | 'delete']> = [
      ['/v1/family', 'get'],
      ['/v1/family', 'patch'],
      ['/v1/family/parents', 'get'],
      ['/v1/family/parents', 'post'],
      ['/v1/family/parents/{id}', 'patch'],
      ['/v1/family/parents/{id}', 'delete'],
      ['/v1/family/message-presets', 'get'],
      ['/v1/family/message-presets', 'put'],
      ['/v1/family/parent-code', 'get'],
      ['/v1/family/parent-code/rotate', 'post'],
      ['/v1/admin/families', 'get'],
      ['/v1/admin/families', 'post'],
      ['/v1/admin/families/{id}/parents', 'post'],
      ['/v1/admin/families/{id}/disable', 'post'],
    ];
    for (const [path, method] of routes) {
      expect(doc.paths?.[path]?.[method]?.security, `${method} ${path}`).toEqual([{ bearerAuth: [] }]);
    }
    expect(Object.keys(doc.components?.schemas ?? {})).toEqual(
      expect.arrayContaining([
        'AdminFamily',
        'AdminFamilyCreate',
        'AdminFamilyCreated',
        'Family',
        'FamilyPatch',
        'MessagePreset',
        'MessagePresetsPut',
        'Parent',
        'ParentCodeSecret',
        'ParentCreate',
        'ParentPatch',
      ]),
    );
  });

  it('describes the kid routes, all behind bearer auth', () => {
    const routes: Array<[string, 'get' | 'post' | 'patch' | 'put' | 'delete']> = [
      ['/v1/kids', 'get'],
      ['/v1/kids', 'post'],
      ['/v1/kids/{kidId}', 'get'],
      ['/v1/kids/{kidId}', 'patch'],
      ['/v1/kids/{kidId}', 'delete'],
      ['/v1/kids/{kidId}/schedule', 'get'],
      ['/v1/kids/{kidId}/schedule', 'put'],
      ['/v1/kids/{kidId}/contacts', 'get'],
      ['/v1/kids/{kidId}/contacts', 'put'],
    ];
    for (const [path, method] of routes) {
      expect(doc.paths?.[path]?.[method]?.security, `${method} ${path}`).toEqual([{ bearerAuth: [] }]);
    }
    expect(Object.keys(doc.components?.schemas ?? {})).toEqual(
      expect.arrayContaining([
        'AvatarColor',
        'Kid',
        'KidContact',
        'KidContactsPut',
        'KidCreate',
        'KidPatch',
        'Schedule',
        'ScheduleDay',
        'ScheduleInput',
      ]),
    );
  });

  it('describes enrolment and the device routes, each with the right auth', () => {
    const parentRoutes: Array<[string, 'get' | 'post' | 'patch' | 'delete']> = [
      ['/v1/kids/{kidId}/enrolment-codes', 'post'],
      ['/v1/devices', 'get'],
      ['/v1/devices/{id}', 'patch'],
      ['/v1/devices/{id}', 'delete'],
    ];
    for (const [path, method] of parentRoutes) {
      expect(doc.paths?.[path]?.[method]?.security, `${method} ${path}`).toEqual([{ bearerAuth: [] }]);
    }
    expect(doc.paths?.['/v1/enrol']?.post).toBeDefined();
    expect(doc.paths?.['/v1/enrol']?.post?.security).toBeUndefined();
    expect(doc.paths?.['/v1/device/me']?.get?.security).toEqual([{ deviceAuth: [] }]);
    expect(doc.components?.securitySchemes?.deviceAuth).toMatchObject({ type: 'http', scheme: 'bearer' });
    expect(Object.keys(doc.components?.schemas ?? {})).toEqual(
      expect.arrayContaining([
        'Device',
        'DeviceForm',
        'DeviceMe',
        'DevicePatch',
        'EnrolmentCode',
        'EnrolmentCodeCreate',
        'EnrolRequest',
        'EnrolResponse',
        'Platform',
        'Pool',
      ]),
    );
  });

  it('describes the state snapshot, usage upload and the dashboard', () => {
    expect(doc.paths?.['/v1/device/state']?.get?.security).toEqual([{ deviceAuth: [] }]);
    expect(doc.paths?.['/v1/device/state']?.get?.responses?.['304']).toBeDefined();
    expect(doc.paths?.['/v1/device/usage']?.post?.security).toEqual([{ deviceAuth: [] }]);
    expect(doc.paths?.['/v1/today']?.get?.security).toEqual([{ bearerAuth: [] }]);
    expect(Object.keys(doc.components?.schemas ?? {})).toEqual(
      expect.arrayContaining([
        'DeviceState',
        'LockReason',
        'PoolSegment',
        'StateGrant',
        'Today',
        'TodayDevice',
        'TodayKid',
        'TodayPool',
        'UsageReceipt',
        'UsageSegmentIn',
        'UsageUpload',
      ]),
    );
  });

  it('describes the grant routes, all behind bearer auth', () => {
    expect(doc.paths?.['/v1/kids/{kidId}/grants']?.get?.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.paths?.['/v1/kids/{kidId}/grants']?.post?.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.paths?.['/v1/kids/{kidId}/lock-now']?.post?.security).toEqual([{ bearerAuth: [] }]);
    expect(Object.keys(doc.components?.schemas ?? {})).toEqual(
      expect.arrayContaining(['Grant', 'GrantCreate', 'LocalDate', 'LockNow']),
    );
  });

  it('matches the committed contract/openapi.json (run `pnpm contract` if this fails)', () => {
    const committed = readFileSync(new URL('../../contract/openapi.json', import.meta.url), 'utf8');
    expect(committed).toBe(`${JSON.stringify(doc, null, 2)}\n`);
  });
});
