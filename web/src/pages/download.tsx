import { useQuery } from '@tanstack/react-query';
import { Download, Laptop, Loader2, RefreshCw, Smartphone, Tablet } from 'lucide-react';
import { useState } from 'react';
import { Brand } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  detectPlatform,
  type DownloadFile,
  downloadsFor,
  fetchDownloads,
  formatSize,
  type Platform,
  PLATFORM_NAMES,
} from '@/lib/downloads';
import { cn } from '@/lib/utils';

const GUIDE = 'https://github.com/jamesgallagher/ScreenTime/blob/main/docs/guides/';

type Kind = 'parent' | 'kid' | 'windows';

const ABOUT: Record<Kind, { title: string; who: string; steps: string[]; note?: string }> = {
  parent: {
    title: 'ST Parent',
    who: "For Mum and Dad's phones: today's time, asks and messages, SOS alerts and parent mode.",
    steps: [
      'Tap Download.',
      'Open the file when it has downloaded. If Android asks, allow your browser to install apps.',
      'Tap Install, then open ST Parent and sign in with your email.',
    ],
    note: 'To update it, download it again and install it over the top. You stay signed in.',
  },
  kid: {
    title: 'ST Kid',
    who: "For a kid's phone or tablet. Setting it up needs a computer with a USB cable, once.",
    steps: [
      'Download it on the computer, not on the kid\'s device.',
      'Follow the Android guide: it installs the app with a USB cable and pairs it with the family.',
    ],
    note: 'After that it updates itself. You never need to download it again for that device.',
  },
  windows: {
    title: 'Screen Time for Windows',
    who: "For a kid's Windows PC. Install it signed in as a parent.",
    steps: [
      'Download it on the kid\'s PC, signed in as a parent.',
      'Open it. If Windows says it protected your PC, choose More info, then Run anyway.',
      'Press Next, then Install, and allow the administrator question.',
      'When it says Screen Time is installed, press Finish with Open Screen Time Setup ticked (or later: Start, then Screen Time Setup). Sign in there with your parent email, then pick the kid for each account.',
    ],
    note: 'To update, install the newer one over the top. The accounts stay connected.',
  },
};

const GUIDES: Record<Kind, string> = {
  parent: `${GUIDE}android-provisioning.md#7-the-parents-phones`,
  kid: `${GUIDE}android-provisioning.md`,
  windows: `${GUIDE}windows-install.md`,
};

const DETECTED: Record<Platform, string> = {
  'android-phone': 'This looks like an Android phone.',
  'android-tablet': 'This looks like an Android tablet.',
  windows: 'This looks like a Windows PC.',
  other: 'Screen Time has apps for Android and Windows.',
};

const PLATFORM_ICONS: Record<Platform, typeof Smartphone> = {
  'android-phone': Smartphone,
  'android-tablet': Tablet,
  windows: Laptop,
  other: Download,
};

function DownloadCard({ kind, file, main }: { kind: Kind; file: DownloadFile | null; main: boolean }) {
  const about = ABOUT[kind];
  return (
    <Card className={cn('flex flex-col', main && 'border-primary/40')}>
      <CardHeader>
        <CardTitle className={main ? 'text-2xl' : undefined}>{about.title}</CardTitle>
        <CardDescription>{about.who}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        {file ? (
          <Button asChild variant={main ? 'default' : 'outline'} className="w-full sm:w-auto sm:self-start">
            <a href={file.url} download={file.fileName}>
              <Download />
              Download {file.versionName} · {formatSize(file.sizeBytes)}
            </a>
          </Button>
        ) : (
          <p className="rounded-xl bg-surface-variant/60 px-4 py-3 text-sm text-muted">Not published yet.</p>
        )}
        <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm">
          {about.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        {about.note && <p className="text-sm text-muted">{about.note}</p>}
        <a href={GUIDES[kind]} className="mt-auto text-sm font-medium text-primary underline-offset-4 hover:underline">
          The full guide
        </a>
      </CardContent>
    </Card>
  );
}

/**
 * The download page at /app (docs/SPEC.md §12.5): no sign-in. It picks the visitor's device from the browser and puts
 * the right download first: the parent app on an Android phone or tablet, the installer on a Windows PC. The latest
 * version is always the one published on this server.
 */
export function DownloadPage() {
  const detected = detectPlatform(navigator.userAgent);
  const [platform, setPlatform] = useState<Platform>(detected);
  const downloads = useQuery({ queryKey: ['downloads'], queryFn: fetchDownloads });
  const kinds = downloadsFor(platform);
  const [first, ...rest] = kinds;
  const Icon = PLATFORM_ICONS[platform];
  const wide = platform === 'windows' || platform === 'other';

  return (
    <div className="flex min-h-dvh flex-col items-center gap-6 px-4 py-8 sm:py-12">
      <Brand />
      <div className={cn('flex w-full flex-col gap-6', wide ? 'max-w-4xl' : platform === 'android-tablet' ? 'max-w-3xl' : 'max-w-md')}>
        <div className="flex flex-col gap-2 text-center">
          <h1 className="text-2xl font-semibold sm:text-3xl">Get Screen Time</h1>
          <p className="inline-flex items-center justify-center gap-2 text-sm text-muted">
            <Icon className="size-4" />
            {platform === detected ? DETECTED[platform] : `Showing downloads for an ${PLATFORM_NAMES[platform]}.`.replace('an Windows', 'a Windows')}
          </p>
        </div>

        {downloads.isError ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
              <p className="text-sm text-danger" role="alert">
                Can't reach the server. Check the internet and try again.
              </p>
              <Button variant="outline" onClick={() => void downloads.refetch()}>
                <RefreshCw />
                Try again
              </Button>
            </CardContent>
          </Card>
        ) : !downloads.data ? (
          <div className="flex justify-center py-16 text-muted" aria-label="Loading">
            <Loader2 className="size-8 animate-spin" />
          </div>
        ) : platform === 'android-tablet' ? (
          // A tablet has the room for both side by side.
          <div className="grid gap-4 sm:grid-cols-2">
            {kinds.map((k, i) => (
              <DownloadCard key={k} kind={k} file={downloads.data[k]} main={i === 0} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {first && <DownloadCard kind={first} file={downloads.data[first]} main />}
            {rest.length > 0 && (
              <>
                <h2 className="pt-2 text-sm font-medium text-muted">
                  {platform === 'windows' ? 'Setting up an Android phone or tablet from this PC' : 'Also'}
                </h2>
                <div className={cn('grid gap-4', wide && 'md:grid-cols-2')}>
                  {rest.map((k) => (
                    <DownloadCard key={k} kind={k} file={downloads.data[k]} main={false} />
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        <nav aria-label="Other devices" className="flex flex-wrap items-center justify-center gap-2 pt-2 text-sm">
          <span className="text-muted">On another device?</span>
          {(['android-phone', 'android-tablet', 'windows'] as const).map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={platform === p}
              onClick={() => setPlatform(p)}
              className={cn(
                'h-9 rounded-full border border-outline px-3 font-medium transition-colors outline-none hover:bg-surface-variant focus-visible:ring-2 focus-visible:ring-primary',
                platform === p && 'border-primary bg-primary/10 text-primary',
              )}
            >
              {PLATFORM_NAMES[p]}
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}
