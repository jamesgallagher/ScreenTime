import { describe, expect, it } from 'vitest';
import { parseTitle } from '../src/reports/titles.js';

describe('title rules (docs/SPEC.md §12.10)', () => {
  it('edge: the profile, the private marker, the other tabs and the browser only', () => {
    expect(parseTitle('msedge.exe', 'Wikipedia - Profile 1 - Microsoft Edge')).toEqual({ page: 'Wikipedia', private: false, search: null });
    expect(parseTitle('msedge.exe', 'Example Domain and 1 more page - Profile 1 - Microsoft Edge')).toEqual({
      page: 'Example Domain',
      private: false,
      search: null,
    });
    expect(parseTitle('msedge.exe', 'how to draw - Search and 2 more pages - [InPrivate] - Microsoft Edge')).toEqual({
      page: 'how to draw - Search',
      private: true,
      search: { engine: 'bing', query: 'how to draw' },
    });
    expect(parseTitle('msedge.exe', 'minecraft cheats - Search and 1 more page - [InPrivate] - Microsoft Edge')).toEqual({
      page: 'minecraft cheats - Search',
      private: true,
      search: { engine: 'bing', query: 'minecraft cheats' },
    });
    expect(parseTitle('msedge.exe', 'Wikipedia - [InPrivate] - Microsoft Edge')).toEqual({ page: 'Wikipedia', private: true, search: null });
    expect(parseTitle('msedge.exe', 'Rock - Paper - Scissors - Personal - Microsoft Edge')).toEqual({
      page: 'Rock - Paper - Scissors',
      private: false,
      search: null,
    });
    expect(parseTitle('msedge.exe', 'Shop - Work - Microsoft Edge')).toEqual({ page: 'Shop', private: false, search: null });
    expect(parseTitle('msedge.exe', 'HOW TO DRAW - Search - Microsoft Edge')).toEqual({
      page: 'HOW TO DRAW - Search',
      private: false,
      search: { engine: 'bing', query: 'HOW TO DRAW' },
    });
    expect(parseTitle('msedge.exe', 'New tab - Profile 1 - Microsoft Edge')).toEqual({ page: null, private: false, search: null });
    expect(parseTitle('msedge.exe', 'Microsoft Edge')).toEqual({ page: null, private: false, search: null });
  });

  it('the other browsers, a search per engine, and a query cut at 200 characters', () => {
    expect(parseTitle('chrome.exe', 'fortnite skins - Google Search - Google Chrome')).toEqual({
      page: 'fortnite skins - Google Search',
      private: false,
      search: { engine: 'google', query: 'fortnite skins' },
    });
    expect(parseTitle('chrome.exe', 'Roblox - Google Chrome (Incognito)')).toEqual({ page: 'Roblox', private: true, search: null });
    expect(parseTitle('brave.exe', 'cats at DuckDuckGo - Brave')).toEqual({
      page: 'cats at DuckDuckGo',
      private: false,
      search: { engine: 'duckduckgo', query: 'cats' },
    });
    expect(parseTitle('brave.exe', 'Roblox - Brave (Private)')).toEqual({ page: 'Roblox', private: true, search: null });
    expect(parseTitle('firefox.exe', 'Wikipedia — Mozilla Firefox Private Browsing')).toEqual({ page: 'Wikipedia', private: true, search: null });
    expect(parseTitle('firefox.exe', 'Wikipedia — Mozilla Firefox')).toEqual({ page: 'Wikipedia', private: false, search: null });
    expect(parseTitle('firefox.exe', 'Wikipedia - Mozilla Firefox')).toEqual({ page: 'Wikipedia', private: false, search: null });
    expect(parseTitle('CHROME.EXE', 'x - Google Chrome')).toEqual({ page: 'x', private: false, search: null });
    expect(parseTitle('notepad.exe', 'Untitled - Notepad')).toEqual({ page: 'Untitled - Notepad', private: false, search: null });
    expect(parseTitle('chrome.exe', `${'a'.repeat(250)} - Google Search - Google Chrome`)).toEqual({
      page: `${'a'.repeat(250)} - Google Search`,
      private: false,
      search: { engine: 'google', query: 'a'.repeat(200) },
    });
  });
});
