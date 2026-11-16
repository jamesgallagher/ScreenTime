import { describe, expect, it } from 'vitest';
import { cleanExePath, type DeviceGame, exePathError, gameLine, sortGames } from '../src/lib/games';

function game(over: Partial<DeviceGame> = {}): DeviceGame {
  return { id: 'genshin', label: 'Genshin Impact', exePath: 'C:\\Games\\Genshin\\GenshinImpact.exe', source: 'found', shortcut: false, removedAt: null, ...over };
}

describe('a typed path to a program', () => {
  it('takes a full path to an .exe', () => {
    expect(exePathError('D:\\Games\\Thing\\Thing.exe')).toBeNull();
    expect(exePathError('c:\\Program Files (x86)\\A game\\Play.EXE')).toBeNull();
    expect(exePathError('  D:\\Games\\Thing.exe  ')).toBeNull();
  });

  it('says what is wrong', () => {
    expect(exePathError('')).toBe('Type the full path to the program.');
    expect(exePathError('   ')).toBe('Type the full path to the program.');
    expect(exePathError('Games\\Thing.exe')).toBe('Start with the drive, like C:\\Games\\Thing\\Thing.exe.');
    expect(exePathError('\\\\server\\share\\Thing.exe')).toBe('Start with the drive, like C:\\Games\\Thing\\Thing.exe.');
    expect(exePathError('C:/Games/Thing.exe')).toBe('Start with the drive, like C:\\Games\\Thing\\Thing.exe.');
    expect(exePathError('C:\\Games\\Thing')).toBe('The path must end in .exe.');
    expect(exePathError('C:\\Games\\Thing.exe --fast')).toBe('The path must end in .exe.');
    expect(exePathError('C:\\Games\\Th|ng.exe')).toBe('A path can\'t have < > " | ? * or a second colon.');
    expect(exePathError('C:\\Games\\D:\\Thing.exe')).toBe('A path can\'t have < > " | ? * or a second colon.');
    expect(exePathError(`C:\\${'a'.repeat(260)}.exe`)).toBe('Keep the path under 260 characters.');
  });

  it('drops the quotes Copy as path adds', () => {
    expect(cleanExePath('"D:\\Games\\Thing\\Thing.exe"')).toBe('D:\\Games\\Thing\\Thing.exe');
    expect(cleanExePath('  "D:\\Games\\Thing.exe"  ')).toBe('D:\\Games\\Thing.exe');
    expect(cleanExePath('D:\\Games\\Thing.exe')).toBe('D:\\Games\\Thing.exe');
    expect(exePathError(cleanExePath('"D:\\Games\\Thing.exe"'))).toBeNull();
  });
});

describe('the games list', () => {
  it('shows where a game is, or that it is gone', () => {
    expect(gameLine(game())).toBe('C:\\Games\\Genshin\\GenshinImpact.exe');
    expect(gameLine(game({ removedAt: '2026-11-16T00:00:00Z' }))).toBe('Not on this PC any more');
  });

  it('puts games still on the PC first, by name', () => {
    const list = [
      game({ id: 'z', label: 'Zenless' }),
      game({ id: 'gone', label: 'Alpha', removedAt: '2026-11-16T00:00:00Z' }),
      game({ id: 'custom-1', label: 'beta', source: 'custom' }),
      game({ id: 'g', label: 'Genshin Impact' }),
    ];
    expect(sortGames(list).map((g) => g.id)).toEqual(['custom-1', 'g', 'z', 'gone']);
    expect(list.map((g) => g.id)).toEqual(['z', 'gone', 'custom-1', 'g']);
  });
});
