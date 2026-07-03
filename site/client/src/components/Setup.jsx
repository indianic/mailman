import Reveal from './Reveal.jsx';
import { Lock, ShieldCheck, ExternalLink } from './icons.jsx';

// Mirrors the in-terminal setup guides (mailman account add / auth login).
// Static on purpose — these steps are Google's, not product copy, so they
// don't belong in the editable site_content table.
const METHODS = [
  {
    key: 'app-password',
    icon: Lock,
    title: 'App Password',
    tag: 'Simplest — recommended',
    blurb: 'A 16-character code Google generates just for apps. Paste it once.',
    steps: [
      {
        text: 'Turn ON 2-Step Verification (App Passwords don’t exist until it’s on).',
        href: 'https://myaccount.google.com/signinoptions/two-step-verification',
        link: 'Open 2-Step Verification',
      },
      {
        text: 'Open App Passwords, type a name (e.g. “mailman”), then Create.',
        href: 'https://myaccount.google.com/apppasswords',
        link: 'Open App Passwords',
      },
      {
        text: 'Google shows a 16-character code like “abcd efgh ijkl mnop”. Copy it — paste into mailman (spaces are fine, they’re stripped).',
      },
    ],
    cli: 'mailman account add   →   App Password',
  },
  {
    key: 'oauth2',
    icon: ShieldCheck,
    title: 'Sign in with browser (OAuth2)',
    tag: 'Passwordless · works with passkeys',
    blurb: 'No password stored — sign in through Google. For passkey / passwordless / App-Password-disabled accounts.',
    steps: [
      {
        text: 'Create or pick a Google Cloud project.',
        href: 'https://console.cloud.google.com/projectcreate',
        link: 'Create a project',
      },
      {
        text: 'Enable the Gmail API for that project, then click Enable.',
        href: 'https://console.cloud.google.com/apis/library/gmail.googleapis.com',
        link: 'Enable Gmail API',
      },
      {
        text: 'OAuth consent screen → User type: External → add an app name + your email → Save. Add your Gmail under “Test users”.',
        href: 'https://console.cloud.google.com/apis/credentials/consent',
        link: 'Consent screen',
      },
      {
        text: 'Credentials → Create credentials → OAuth client ID → Application type: Desktop app → Create.',
        href: 'https://console.cloud.google.com/apis/credentials',
        link: 'Create credentials',
        warn: 'Must be “Desktop app”, NOT “Web application” — a Web-app client fails with Error 400: redirect_uri_mismatch.',
      },
      {
        text: 'Copy the Client ID and Client secret from the popup, and paste them into mailman.',
      },
    ],
    cli: 'mailman account add   →   Sign in with browser',
  },
];

function StepList({ steps }) {
  return (
    <ol className="mt-6 space-y-4">
      {steps.map((s, i) => (
        <li key={i} className="flex gap-3">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700 dark:bg-brand-900/50 dark:text-brand-300">
            {i + 1}
          </span>
          <div className="text-sm text-slate-600 dark:text-slate-300">
            <p>{s.text}</p>
            {s.href && (
              <a
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 transition hover:text-brand-500 dark:text-brand-400"
              >
                {s.link}
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
            {s.warn && (
              <p className="mt-2 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                ⚠ {s.warn}
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

export default function Setup() {
  return (
    <section id="setup" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20">
      <Reveal className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Connect your <span className="text-gradient">Gmail</span>
        </h2>
        <p className="mt-4 text-slate-600 dark:text-slate-300">
          Two ways to connect — pick one. Your normal Gmail password{' '}
          <strong className="font-semibold text-slate-800 dark:text-slate-100">won’t work</strong>: Google blocks it for
          mail apps, so you use an App Password or browser sign-in. The same steps appear inside the CLI as you go.
        </p>
      </Reveal>

      <div className="mt-14 grid gap-6 lg:grid-cols-2">
        {METHODS.map((m, i) => {
          const Icon = m.icon;
          return (
            <Reveal key={m.key} delay={i * 0.08}>
              <div className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-7 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
                    <Icon className="h-6 w-6" />
                  </span>
                  <div>
                    <h3 className="text-lg font-semibold">{m.title}</h3>
                    <p className="text-xs font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-400">
                      {m.tag}
                    </p>
                  </div>
                </div>
                <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">{m.blurb}</p>

                <StepList steps={m.steps} />

                <div className="mt-6 rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 font-mono text-xs text-slate-200">
                  <span className="mr-2 text-brand-400">$</span>
                  {m.cli}
                </div>
              </div>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}
