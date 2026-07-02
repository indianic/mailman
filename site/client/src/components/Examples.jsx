import Reveal from './Reveal.jsx';
import TerminalCard from './TerminalCard.jsx';
import { Terminal, ShieldCheck, Bell } from './icons.jsx';
import { useContent } from '../ContentContext.jsx';

const PERKS = [
  { Icon: Terminal, title: 'Never leave your editor', desc: 'No tab-switching to Gmail, no losing your place. Email happens where you already are.' },
  { Icon: ShieldCheck, title: 'Zero context loss', desc: 'Your AI already knows the file, the PR, the error. It writes the email for you.' },
  { Icon: Bell, title: 'Stay in flow', desc: 'Fire it off, get a desktop “sent” ping, keep coding. No distraction, no detour.' },
];

// DB-backed (site_content.examples); fallback only.
const FALLBACK = [
  {
    title: 'claude · ship a PR for review',
    lines: [
      { role: 'prompt', text: 'email the PR link to sandeep for review' },
      { role: 'treetop' },
      { role: 'section', text: 'draft — preview' },
      { role: 'rail', text: 'to · sandeep@indianic.com' },
      { role: 'rail', text: 'subject · Auth refactor ready for review' },
      { role: 'status', text: 'previewed · awaiting confirm' },
      { role: 'treeend', text: 'sent · notification shown' },
    ],
  },
  {
    title: 'cursor · send a build artifact',
    lines: [
      { role: 'prompt', text: 'attach ./dist/report.html and send to qa@indianic.com' },
      { role: 'treetop' },
      { role: 'section', text: 'attachment' },
      { role: 'rail', text: 'report.html · 84 KB (under 25 MB)' },
      { role: 'section', text: 'draft' },
      { role: 'rail', text: 'to · qa@indianic.com' },
      { role: 'rail', text: 'subject · QA build — please verify' },
      { role: 'treeend', text: 'sent' },
    ],
  },
  {
    title: 'gemini · triage without switching tabs',
    lines: [
      { role: 'prompt', text: 'any unread from the Acme client this week?' },
      { role: 'treetop' },
      { role: 'section', text: 'inbox — Acme Corp' },
      { role: 'rail', text: 'Re: staging credentials' },
      { role: 'rail', text: 'Invoice #4412' },
      { role: 'rail', text: 'Launch date confirmation?' },
      { role: 'status', text: '3 unread' },
      { role: 'treeend', text: 'reply sent · confirmed for Aug 12' },
    ],
  },
  {
    title: 'claude · schedule the EOD summary',
    lines: [
      { role: 'prompt', text: 'schedule an EOD update to the team tomorrow at 9am' },
      { role: 'treetop' },
      { role: 'section', text: 'schedule' },
      { role: 'rail', text: 'when · Jul 3, 09:00 (Asia/Kolkata)' },
      { role: 'rail', text: 'fires via an OS timer even if the editor is closed' },
      { role: 'status', text: 'queued · id sch_20e8…' },
      { role: 'treeend', text: 'ready' },
    ],
  },
  {
    title: 'zsh · mailman status',
    lines: [
      { role: 'cmd', text: 'mailman status' },
      { role: 'treetop' },
      { role: 'section', text: 'accounts' },
      { role: 'rail', text: 'default · you@gmail.com (App Password)' },
      { role: 'rail', text: 'work · you@company.com' },
      { role: 'section', text: 'security' },
      { role: 'status', text: 'keychain reachable · AES-256-GCM' },
      { role: 'section', text: 'scheduler' },
      { role: 'status', text: 'launchd ticker installed' },
      { role: 'section', text: 'notifications' },
      { role: 'rail', text: 'desktop: on' },
      { role: 'treeend', text: 'ready' },
    ],
  },
  {
    title: 'windsurf · loop a teammate on an error',
    lines: [
      { role: 'prompt', text: 'forward this stack trace to aadil and ask if he’s seen it' },
      { role: 'treetop' },
      { role: 'section', text: 'draft' },
      { role: 'rail', text: 'to · aadil.a@indianic.com' },
      { role: 'rail', text: 'subject · Seen this before?' },
      { role: 'rail', text: 'the trace is quoted inline' },
      { role: 'treeend', text: 'sent · back to your code' },
    ],
  },
];

export default function Examples() {
  const EXAMPLES = useContent('examples', FALLBACK);
  return (
    <section
      id="examples"
      className="scroll-mt-20 border-y border-slate-200 bg-slate-50 py-20 dark:border-slate-800 dark:bg-slate-900/40"
    >
      <div className="mx-auto max-w-6xl px-5">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Stay in your <span className="text-gradient">flow</span>
          </h2>
          <p className="mt-4 text-slate-600 dark:text-slate-300">
            Email is where developers lose focus — the tab-switch, the re-read, the “wait, what was
            I doing?” MailMan keeps it all in the terminal, so you handle it in one line and get
            straight back to work.
          </p>
        </Reveal>

        {/* value strip — one reveal for the whole row (per-item reveals were
            unreliable and left items invisible) */}
        <Reveal className="mx-auto mt-12 grid max-w-4xl gap-6 sm:grid-cols-3">
          {PERKS.map((p) => (
            <div key={p.title} className="flex flex-col items-center text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
                <p.Icon className="h-6 w-6" />
              </span>
              <h3 className="mt-4 font-semibold">{p.title}</h3>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{p.desc}</p>
            </div>
          ))}
        </Reveal>

        {/* terminal “screenshots” — one reveal for the whole grid */}
        <Reveal delay={0.1} className="mt-14 grid gap-6 lg:grid-cols-2">
          {EXAMPLES.map((ex) => (
            <TerminalCard key={ex.title} title={ex.title} lines={ex.lines} />
          ))}
        </Reveal>

        <Reveal delay={0.1} className="mt-10 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Every send still follows <strong className="text-slate-700 dark:text-slate-200">draft → preview → confirm</strong>.
            You stay fast <em>and</em> in control.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
