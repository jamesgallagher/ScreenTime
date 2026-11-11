import { describe, expect, it } from 'vitest';
import { detectPlatform, downloadsFor, formatSize } from '../src/lib/downloads';

const PIXEL = 'Mozilla/5.0 (Linux; Android 17; Pixel 10 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const REDMI = 'Mozilla/5.0 (Linux; Android 16; 2409BRN2CY Build/BP2A.250605.031) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const TABLET = 'Mozilla/5.0 (Linux; Android 14; Magic Drawing Pad) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15';

describe('the device the download page sees', () => {
  it('tells an Android phone from an Android tablet', () => {
    expect(detectPlatform(PIXEL)).toBe('android-phone');
    expect(detectPlatform(REDMI)).toBe('android-phone');
    expect(detectPlatform(TABLET)).toBe('android-tablet');
  });

  it('knows a Windows PC, and gives everything to anything else', () => {
    expect(detectPlatform(WINDOWS)).toBe('windows');
    expect(detectPlatform(IPHONE)).toBe('other');
    expect(detectPlatform(MAC)).toBe('other');
  });

  it('puts the most useful download first', () => {
    expect(downloadsFor('android-phone')).toEqual(['parent', 'kid']);
    expect(downloadsFor('android-tablet')).toEqual(['parent', 'kid']);
    expect(downloadsFor('windows')).toEqual(['windows', 'parent', 'kid']);
    expect(downloadsFor('other')).toEqual(['parent', 'windows', 'kid']);
  });

  it('writes sizes simply', () => {
    expect(formatSize(63_171_519)).toBe('60 MB');
    expect(formatSize(655_360)).toBe('640 KB');
    expect(formatSize(10)).toBe('1 KB');
  });
});
