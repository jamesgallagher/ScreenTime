import { describe, expect, it } from 'vitest';
import {
  bedtimeAction,
  bedtimeChoices,
  bedtimeClock,
  bedtimeLine,
  laterText,
  quickChoices,
  startChoice,
  stepChoice,
  type TodayBedtime,
} from '../src/lib/bedtime';

function bed(over: Partial<TodayBedtime> = {}): TodayBedtime {
  return { scheduled: '20:30', tonight: '20:30', extendedBy: null, earliest: '20:45', ...over };
}

describe('the bedtime row', () => {
  it('reads the usual bedtime, an extension and no bedtime', () => {
    expect(bedtimeLine(bed())).toEqual({ text: 'Bedtime 8:30 pm', detail: null });
    expect(bedtimeLine(bed({ tonight: '21:30', extendedBy: 'Dad' }))).toEqual({
      text: 'Bedtime 9:30 pm tonight',
      detail: 'Extended by Dad · usually 8:30 pm',
    });
    expect(bedtimeLine(bed({ tonight: '24:00', extendedBy: 'Mum' })).text).toBe('Bedtime midnight tonight');
    expect(bedtimeLine(bed({ scheduled: '24:00', tonight: '24:00', earliest: null }))).toEqual({ text: 'No bedtime today', detail: null });
  });

  it('offers Extend, Change or nothing', () => {
    expect(bedtimeAction(bed())).toBe('Extend');
    expect(bedtimeAction(bed({ tonight: '21:30', extendedBy: 'Dad' }))).toBe('Change');
    expect(bedtimeAction(bed({ tonight: '21:30', extendedBy: 'Dad', earliest: null }))).toBe('Change');
    expect(bedtimeAction(bed({ earliest: null }))).toBeNull();
    expect(bedtimeAction(bed({ scheduled: '24:00', tonight: '24:00', earliest: null }))).toBeNull();
  });
});

describe('the bedtime dialog', () => {
  it('offers the earliest time to midnight in quarter hours', () => {
    const choices = bedtimeChoices(bed({ earliest: '23:00' }));
    expect(choices).toEqual(['23:00', '23:15', '23:30', '23:45', '24:00']);
    expect(bedtimeChoices(bed()).length).toBe(14);
    expect(bedtimeChoices(bed({ earliest: null }))).toEqual([]);
  });

  it('keeps an extension under way pickable', () => {
    expect(bedtimeChoices(bed({ tonight: '21:00', extendedBy: 'Dad', earliest: '21:15' }))[0]).toBe('21:00');
    expect(bedtimeChoices(bed({ tonight: '21:00', extendedBy: 'Dad', earliest: null }))).toEqual(['21:00']);
  });

  it('starts an hour later than usual, or on the extension', () => {
    expect(startChoice(bed())).toBe('21:30');
    expect(startChoice(bed({ earliest: '22:00' }))).toBe('22:00');
    expect(startChoice(bed({ scheduled: '23:30', tonight: '23:30', earliest: '23:45' }))).toBe('24:00');
    expect(startChoice(bed({ tonight: '22:15', extendedBy: 'Mum' }))).toBe('22:15');
    expect(startChoice(bed({ earliest: null }))).toBeNull();
  });

  it('steps through the choices and stops at the ends', () => {
    const choices = ['21:00', '21:15', '21:30'];
    expect(stepChoice(choices, '21:15', 1)).toBe('21:30');
    expect(stepChoice(choices, '21:30', 1)).toBe('21:30');
    expect(stepChoice(choices, '21:00', -1)).toBe('21:00');
    expect(stepChoice(choices, '20:00', 1)).toBe('21:00');
  });

  it('offers +30m, +1h and +2h only when they can be picked', () => {
    expect(quickChoices(bed())).toEqual([
      { label: '+30m', value: '21:00' },
      { label: '+1h', value: '21:30' },
      { label: '+2h', value: '22:30' },
    ]);
    expect(quickChoices(bed({ earliest: '21:15' })).map((q) => q.value)).toEqual([null, '21:30', '22:30']);
    expect(quickChoices(bed({ scheduled: '23:00', tonight: '23:00', earliest: '23:15' })).map((q) => q.value)).toEqual([
      '23:30',
      '24:00',
      null,
    ]);
  });

  it('says how much later and shows the time', () => {
    expect(laterText(bed(), '21:30')).toBe('1h 00m later than usual');
    expect(laterText(bed(), '20:45')).toBe('15m later than usual');
    expect(bedtimeClock('21:30')).toBe('9:30 pm');
    expect(bedtimeClock('24:00')).toBe('Midnight');
  });
});
