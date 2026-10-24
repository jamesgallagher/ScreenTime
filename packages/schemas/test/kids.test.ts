import { describe, expect, it } from 'vitest';
import { KidContactsPut, KidCreate, ScheduleInput } from '../src/index.js';

const day = (weekday: number) => ({ weekday, screensMin: 120, phoneMin: 90, wake: '07:00', bedtime: '20:30' });
const week = () => [1, 2, 3, 4, 5, 6, 7].map(day);

describe('kid schemas', () => {
  it('needs a trimmed name and one of the 8 avatar colours', () => {
    expect(KidCreate.parse({ name: ' Alex ', avatarColor: '#0F766E' }).name).toBe('Alex');
    expect(KidCreate.safeParse({ name: 'Alex', avatarColor: '#000000' }).success).toBe(false);
    expect(KidCreate.safeParse({ name: ' ', avatarColor: '#0F766E' }).success).toBe(false);
  });

  it('accepts a full week from Monday to Sunday only', () => {
    expect(ScheduleInput.safeParse({ warn1Min: 15, warn2Min: 5, days: week() }).success).toBe(true);
    expect(ScheduleInput.safeParse({ warn1Min: 15, warn2Min: 5, days: week().slice(0, 6) }).success).toBe(false);
    expect(ScheduleInput.safeParse({ warn1Min: 15, warn2Min: 5, days: week().reverse() }).success).toBe(false);
  });

  it('checks allowances, times and warnings', () => {
    const withDay = (patch: object) => ({ warn1Min: 15, warn2Min: 5, days: [{ ...day(1), ...patch }, ...week().slice(1)] });
    expect(ScheduleInput.safeParse(withDay({ wake: '00:00', bedtime: '24:00', screensMin: 1440 })).success).toBe(true);
    expect(ScheduleInput.safeParse(withDay({ screensMin: 1441 })).success).toBe(false);
    expect(ScheduleInput.safeParse(withDay({ phoneMin: 30.5 })).success).toBe(false);
    expect(ScheduleInput.safeParse(withDay({ wake: '7:00' })).success).toBe(false);
    expect(ScheduleInput.safeParse(withDay({ wake: '21:00', bedtime: '20:30' })).success).toBe(false);
    expect(ScheduleInput.safeParse(withDay({ bedtime: '24:30' })).success).toBe(false);
    expect(ScheduleInput.safeParse({ warn1Min: 5, warn2Min: 5, days: week() }).success).toBe(false);
    expect(ScheduleInput.safeParse({ warn1Min: 61, warn2Min: 5, days: week() }).success).toBe(false);
    expect(ScheduleInput.safeParse({ warn1Min: 15, warn2Min: 0, days: week() }).success).toBe(false);
  });

  it('allows up to 10 contacts with international numbers', () => {
    const contact = { label: 'Grandma', phoneE164: '+61412345678' };
    expect(KidContactsPut.safeParse({ contacts: Array(10).fill(contact) }).success).toBe(true);
    expect(KidContactsPut.safeParse({ contacts: Array(11).fill(contact) }).success).toBe(false);
    expect(KidContactsPut.safeParse({ contacts: [{ ...contact, phoneE164: '0412345678' }] }).success).toBe(false);
  });
});
