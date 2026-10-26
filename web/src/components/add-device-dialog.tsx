import type { Device, DeviceForm, EnrolmentCode } from '@screentime/schemas';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, Loader2, Monitor, RefreshCw, Smartphone, Tablet } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ApiError } from '@/lib/api';
import { api } from '@/lib/auth';
import { countdownText, FORM_NAMES, spacedCode } from '@/lib/kid';
import { useDevices } from '@/pages/kids';

const FORMS: { form: DeviceForm; icon: typeof Smartphone; detail: string }[] = [
  { form: 'phone', icon: Smartphone, detail: 'Android phone. Counts as Phone time.' },
  { form: 'tablet', icon: Tablet, detail: 'Android tablet. Counts as Screens time.' },
  { form: 'pc', icon: Monitor, detail: 'Windows PC account. Counts as Screens time.' },
];

/** "phone", "tablet", "PC", for the middle of a sentence. */
function formWord(form: DeviceForm): string {
  return form === 'pc' ? 'PC' : FORM_NAMES[form].toLowerCase();
}

/** Re-renders every second while mounted. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function CodeStep({
  kidId,
  kidName,
  form,
  code,
  knownIds,
  onNewCode,
  busy,
  onDone,
}: {
  kidId: string;
  kidName: string;
  form: DeviceForm;
  code: EnrolmentCode;
  knownIds: Set<string>;
  onNewCode: () => void;
  busy: boolean;
  onDone: () => void;
}) {
  const now = useNow();
  const expired = new Date(code.expiresAt).getTime() <= now.getTime();
  // Looks for the new device every 3 seconds while the code is shown.
  const devices = useDevices(expired ? undefined : 3000);
  const added = devices.data?.find((d) => d.kidId === kidId && !knownIds.has(d.id));

  if (added) {
    return (
      <>
        <DialogTitle>{added.name} is connected</DialogTitle>
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <CircleCheck className="size-16 text-primary" />
          <p className="text-sm text-muted">
            It now counts toward {kidName}'s {added.pool === 'phone' ? 'Phone' : 'Screens'} time. You can rename it on the
            Devices tab.
          </p>
        </div>
        <Button onClick={onDone}>Done</Button>
      </>
    );
  }

  return (
    <>
      <DialogTitle>
        Add {kidName}'s {formWord(form)}
      </DialogTitle>
      <DialogDescription>
        {form === 'pc'
          ? `On the PC, a parent runs the ScreenTime installer and types this code for ${kidName}'s Windows account.`
          : `On ${kidName}'s ${formWord(form)}, open Screen Time and tap Scan QR code, or type the code.`}
      </DialogDescription>
      {form !== 'pc' && (
        <div className="flex justify-center">
          <div className={expired ? 'rounded-2xl bg-white p-3 opacity-20' : 'rounded-2xl bg-white p-3'}>
            <QRCodeSVG value={code.qrPayload} size={208} fgColor="#1C1917" bgColor="#FFFFFF" marginSize={1} title="Enrolment QR code" />
          </div>
        </div>
      )}
      <div className="text-center">
        {form !== 'pc' && <p className="text-sm text-muted">Or type this code</p>}
        <p
          className={expired ? 'text-5xl font-semibold tracking-widest text-muted tabular-nums line-through' : 'text-5xl font-semibold tracking-widest tabular-nums'}
          data-testid="enrol-code"
        >
          {spacedCode(code.code)}
        </p>
        <p className="mt-2 text-sm text-muted tabular-nums" aria-live="polite">
          {expired ? 'This code has expired.' : `Works once. Expires in ${countdownText(code.expiresAt, now)}`}
        </p>
      </div>
      {expired ? (
        <Button onClick={onNewCode} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          Make a new code
        </Button>
      ) : (
        <p className="flex items-center justify-center gap-2 text-sm text-muted">
          <Loader2 className="size-4 animate-spin" />
          Waiting for the device…
        </p>
      )}
    </>
  );
}

/** The dialog's body: mounted fresh each time it opens. */
function AddDeviceBody({ kidId, kidName, onDone }: { kidId: string; kidName: string; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<DeviceForm | null>(null);
  // The kid's devices when the dialog opened: a device that is not in this set is the new one.
  const [knownIds] = useState(
    () => new Set((queryClient.getQueryData<Device[]>(['devices']) ?? []).filter((d) => d.kidId === kidId).map((d) => d.id)),
  );
  const makeCode = useMutation({
    mutationFn: (f: DeviceForm) => api.post<EnrolmentCode>(`/v1/kids/${kidId}/enrolment-codes`, { form: f }),
  });

  if (form && makeCode.data) {
    return (
      <CodeStep
        kidId={kidId}
        kidName={kidName}
        form={form}
        code={makeCode.data}
        knownIds={knownIds}
        busy={makeCode.isPending}
        onNewCode={() => makeCode.mutate(form)}
        onDone={onDone}
      />
    );
  }

  return (
    <>
      <DialogTitle>Add a device for {kidName}</DialogTitle>
      <DialogDescription>What are you adding? You get a code that works once, for 10 minutes.</DialogDescription>
      <div className="flex flex-col gap-2">
        {FORMS.map(({ form: f, icon: Icon, detail }) => (
          <button
            key={f}
            type="button"
            disabled={makeCode.isPending}
            onClick={() => {
              setForm(f);
              makeCode.mutate(f);
            }}
            className="flex items-center gap-4 rounded-2xl border border-outline p-4 text-left transition-colors outline-none hover:bg-surface-variant focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
          >
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              {makeCode.isPending && form === f ? <Loader2 className="size-5 animate-spin" /> : <Icon className="size-5" />}
            </span>
            <span>
              <span className="block font-medium">{FORM_NAMES[f]}</span>
              <span className="block text-sm text-muted">{detail}</span>
            </span>
          </button>
        ))}
      </div>
      {makeCode.error && (
        <p role="alert" className="text-sm text-danger">
          {makeCode.error instanceof ApiError ? makeCode.error.message : 'Something went wrong. Try again.'}
        </p>
      )}
    </>
  );
}

/** docs/SPEC.md §11.3 and §16.4 Add device: pick Phone, Tablet or PC, then a QR code and the 6 digits with a 10-minute countdown. */
export function AddDeviceDialog({
  open,
  kidId,
  kidName,
  onClose,
}: {
  open: boolean;
  kidId: string;
  kidName: string;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>{open && <AddDeviceBody kidId={kidId} kidName={kidName} onDone={onClose} />}</DialogContent>
    </Dialog>
  );
}
