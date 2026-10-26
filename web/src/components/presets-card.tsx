import type { MessagePreset } from '@screentime/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUp, Check, Loader2, MessageSquare, Plus, RefreshCw, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { api } from '@/lib/auth';
import { MAX_PRESETS, PRESET_MAX_LENGTH, presetErrors } from '@/lib/settings';

interface Row {
  key: string;
  text: string;
}

function messageOf(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong. Try again.';
}

function rowsOf(presets: MessagePreset[]): Row[] {
  return presets.map((p) => ({ key: p.id, text: p.text }));
}

function bodyOf(rows: Row[]) {
  return rows.map((r) => ({ text: r.text.trim() }));
}

/**
 * docs/SPEC.md §12 (Q29): messages a kid can send to Mum and Dad with one tap, from the kid UI and the block
 * screen. Kids can also type their own. The whole list is saved at once, in this order.
 */
export function PresetsCard() {
  const queryClient = useQueryClient();
  const presets = useQuery({
    queryKey: ['message-presets'],
    queryFn: () => api.get<MessagePreset[]>('/v1/family/message-presets'),
  });
  const [draft, setDraft] = useState<Row[] | null>(null);
  // Errors show after the first Save, not while typing.
  const [tried, setTried] = useState(false);
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: (rows: Row[]) => api.put<MessagePreset[]>('/v1/family/message-presets', { presets: bodyOf(rows) }),
    onSuccess: (result) => {
      queryClient.setQueryData(['message-presets'], result);
      setDraft(null);
      setTried(false);
      setSaved(true);
    },
  });

  if (!presets.data) {
    return presets.isError ? (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <p className="text-sm text-danger" role="alert">
            {messageOf(presets.error)}
          </p>
          <Button variant="outline" onClick={() => void presets.refetch()}>
            <RefreshCw />
            Try again
          </Button>
        </CardContent>
      </Card>
    ) : (
      <Card className="h-64 animate-pulse bg-surface-variant/50" aria-label="Loading" />
    );
  }

  const rows = draft ?? rowsOf(presets.data);
  const dirty = draft !== null && JSON.stringify(bodyOf(draft)) !== JSON.stringify(bodyOf(rowsOf(presets.data)));
  const errors = presetErrors(rows.map((r) => r.text));
  const invalid = errors.some(Boolean);
  const edit = (next: Row[]) => {
    setDraft(next);
    setSaved(false);
    save.reset();
  };
  const moveUp = (index: number) => {
    const next = [...rows];
    const [row] = next.splice(index, 1);
    if (row) next.splice(index - 1, 0, row);
    edit(next);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Messages kids can send</CardTitle>
        <CardDescription>
          Kids tap one of these to send it to every parent, even when their device is locked. They can also type their
          own.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {rows.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-xl bg-surface-variant/60 py-8 text-center">
            <MessageSquare className="size-6 text-muted" />
            <p className="text-sm text-muted">No ready-made messages. Kids can still type their own.</p>
          </div>
        )}
        {rows.map((row, i) => {
          const error = tried ? errors[i] : undefined;
          const length = row.text.trim().length;
          return (
            <div key={row.key} role="group" aria-label={`Message ${i + 1}`} className="flex items-start gap-1">
              <div className="min-w-0 flex-1">
                <Input
                  aria-label={`Message ${i + 1}`}
                  placeholder="Like: Can you call me?"
                  value={row.text}
                  maxLength={PRESET_MAX_LENGTH}
                  aria-invalid={error !== undefined || undefined}
                  onChange={(e) => edit(rows.map((r) => (r.key === row.key ? { ...r, text: e.target.value } : r)))}
                />
                {error ? (
                  <p className="mt-1 text-xs text-danger">{error}</p>
                ) : (
                  length > PRESET_MAX_LENGTH - 20 && (
                    <p className="mt-1 text-xs text-muted">
                      {length} of {PRESET_MAX_LENGTH} characters
                    </p>
                  )
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Move message ${i + 1} up`}
                className="size-10 sm:size-12"
                disabled={i === 0}
                onClick={() => moveUp(i)}
              >
                <ArrowUp />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove message ${i + 1}`}
                className="size-10 sm:size-12"
                onClick={() => edit(rows.filter((r) => r.key !== row.key))}
              >
                <X />
              </Button>
            </div>
          );
        })}
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          disabled={rows.length >= MAX_PRESETS}
          onClick={() => edit([...rows, { key: crypto.randomUUID(), text: '' }])}
        >
          <Plus />
          {rows.length >= MAX_PRESETS ? `${MAX_PRESETS} messages at most` : 'Add a message'}
        </Button>

        <div className="mt-2 flex flex-wrap items-center justify-end gap-3 border-t border-outline pt-4">
          <p aria-live="polite" className="mr-auto text-sm">
            {save.error ? (
              <span className="text-danger">{messageOf(save.error)}</span>
            ) : saved ? (
              <span className="flex items-center gap-1.5 text-primary">
                <Check className="size-4" />
                Saved.
              </span>
            ) : dirty ? (
              <span className="text-muted">Unsaved changes</span>
            ) : null}
          </p>
          {dirty && (
            <Button
              variant="ghost"
              disabled={save.isPending}
              onClick={() => {
                setDraft(null);
                setTried(false);
                save.reset();
              }}
            >
              Undo changes
            </Button>
          )}
          <Button
            disabled={!dirty || save.isPending}
            onClick={() => {
              setTried(true);
              if (!invalid) save.mutate(rows);
            }}
          >
            {save.isPending && <Loader2 className="animate-spin" />}
            Save messages
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
