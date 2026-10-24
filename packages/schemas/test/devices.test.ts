import { describe, expect, it } from 'vitest';
import { DevicePatch, EnrolRequest } from '../src/index.js';

const android = {
  code: '012345',
  platform: 'android',
  hasCellular: true,
  model: 'Pixel 7',
  osVersion: 'Android 14',
  appVersion: '0.1.0',
};

describe('device schemas', () => {
  it('needs a 6-digit code', () => {
    expect(EnrolRequest.safeParse(android).success).toBe(true);
    expect(EnrolRequest.safeParse({ ...android, code: '12345' }).success).toBe(false);
    expect(EnrolRequest.safeParse({ ...android, code: '12345a' }).success).toBe(false);
  });

  it('needs the account details on Windows only', () => {
    const windows = { ...android, platform: 'windows', hasCellular: false, model: 'Dell XPS 13', osVersion: 'Windows 11' };
    expect(EnrolRequest.safeParse(windows).success).toBe(false);
    const account = { machineId: 'machine-guid', windowsUserSid: 'S-1-5-21-1-2-3-1001', windowsUserName: 'alex' };
    expect(EnrolRequest.safeParse({ ...windows, ...account }).success).toBe(true);
  });

  it('allows renaming and moving a device to another pool', () => {
    expect(DevicePatch.parse({ name: ' Alex phone ' }).name).toBe('Alex phone');
    expect(DevicePatch.safeParse({ pool: 'screens' }).success).toBe(true);
    expect(DevicePatch.safeParse({ pool: 'tv' }).success).toBe(false);
  });
});
