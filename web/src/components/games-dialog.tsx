import type { Device } from '@screentime/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gamepad2, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ApiError } from '@/lib/api';
import {
  addCustomGame,
  cleanExePath,
  type DeviceGame,
  exePathError,
  fetchDeviceGames,
  gameLine,
  MAX_EXE_PATH,
  MAX_GAME_LABEL,
  removeCustomGame,
  saveGameShortcut,
  sortGames,
} from '@/lib/games';

function messageOf(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong. Try again.';
}

function GameRow({ deviceId, game }: { deviceId: string; game: DeviceGame }) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['games', deviceId] });
  const shortcut = useMutation({
    mutationFn: (on: boolean) => saveGameShortcut(deviceId, game.id, on),
    onSettled: refresh,
  });
  const remove = useMutation({ mutationFn: () => removeCustomGame(deviceId, game.id), onSettled: refresh });
  const gone = game.removedAt !== null;
  const error = shortcut.error ?? remove.error;
  const switchId = `game-${game.id}`;

  return (
    <li className="flex items-center gap-3 border-t border-outline py-3 first:border-t-0 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <label htmlFor={switchId} className={gone ? 'font-medium text-muted' : 'font-medium'}>
          {game.label}
        </label>
        <p className="truncate text-xs text-muted" title={gone ? undefined : game.exePath}>
          {gameLine(game)}
        </p>
        {error && (
          <p role="alert" className="mt-1 text-xs text-danger">
            {messageOf(error)}
          </p>
        )}
      </div>
      {game.source === 'custom' && (
        <Button variant="ghost" size="icon" aria-label={`Remove ${game.label}`} disabled={remove.isPending} onClick={() => remove.mutate()}>
          {remove.isPending ? <Loader2 className="animate-spin" /> : <Trash2 />}
        </Button>
      )}
      <Switch
        id={switchId}
        aria-label={`Desktop shortcut for ${game.label}`}
        checked={game.shortcut}
        disabled={gone || shortcut.isPending}
        onCheckedChange={(on) => shortcut.mutate(on)}
      />
    </li>
  );
}

function AddProgram({ deviceId }: { deviceId: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [path, setPath] = useState('');
  const [tried, setTried] = useState(false);
  const cleaned = cleanExePath(path);
  const pathError = exePathError(cleaned);
  const add = useMutation({
    mutationFn: () => addCustomGame(deviceId, label.trim(), cleaned),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['games', deviceId] });
      setOpen(false);
      setLabel('');
      setPath('');
      setTried(false);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (label.trim() && !pathError) add.mutate();
  };

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Plus />
        Add another program
      </Button>
    );
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-xl bg-surface-variant/60 p-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="game-label">Name on the shortcut</Label>
        <Input id="game-label" value={label} maxLength={MAX_GAME_LABEL} autoComplete="off" onChange={(e) => setLabel(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="game-path">Path to the program on that PC</Label>
        <Input
          id="game-path"
          value={path}
          maxLength={MAX_EXE_PATH + 2}
          autoComplete="off"
          spellCheck={false}
          placeholder="D:\Games\Thing\Thing.exe"
          aria-invalid={tried && pathError !== null}
          onChange={(e) => setPath(e.target.value)}
        />
        <p className="text-xs text-muted">On the PC, hold Shift, right-click the program and choose Copy as path.</p>
        {tried && pathError && (
          <p role="alert" className="text-xs text-danger">
            {pathError}
          </p>
        )}
      </div>
      {add.error && (
        <p role="alert" className="text-sm text-danger">
          {messageOf(add.error)}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Button type="button" variant="outline" disabled={add.isPending} onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button type="submit" disabled={add.isPending || !label.trim()}>
          {add.isPending && <Loader2 className="animate-spin" />}
          Add
        </Button>
      </div>
    </form>
  );
}

/**
 * The body of the Games dialog for one PC account (docs/SPEC.md §12.6): a switch per game the PC found, the programs
 * a parent added by hand, and a form to add one. A switch that is on puts a shortcut on the kid's desktop.
 */
export function GamesBody({ device, kidName }: { device: Device; kidName: string }) {
  const games = useQuery({ queryKey: ['games', device.id], queryFn: () => fetchDeviceGames(device.id) });

  return (
    <>
      <DialogTitle>Games on {device.name}</DialogTitle>
      <DialogDescription>
        Some games ask for an administrator every time they start. Turn one on and a shortcut appears on {kidName}'s
        desktop that starts it without asking. Updating a game still needs a parent.
      </DialogDescription>
      {games.isError ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <p className="text-sm text-danger" role="alert">
            {messageOf(games.error)}
          </p>
          <Button variant="outline" onClick={() => void games.refetch()}>
            <RefreshCw />
            Try again
          </Button>
        </div>
      ) : !games.data ? (
        <div className="h-20 animate-pulse rounded-xl bg-surface-variant/50" aria-label="Loading" />
      ) : games.data.games.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl bg-surface-variant/60 px-4 py-6 text-center">
          <Gamepad2 className="size-6 text-muted" />
          <p className="text-sm text-muted">No games found on this PC yet. It looks again each time it starts and every few hours.</p>
        </div>
      ) : (
        <ul>
          {sortGames(games.data.games).map((game) => (
            <GameRow key={game.id} deviceId={device.id} game={game} />
          ))}
        </ul>
      )}
      <AddProgram deviceId={device.id} />
    </>
  );
}
