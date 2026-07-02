import Reveal from './Reveal.jsx';
import {
  MessageSquare, ShieldCheck, Paperclip, Clock, Inbox, Users, Bell, Lock, Laptop,
} from './icons.jsx';

const FEATURES = [
  {
    Icon: MessageSquare,
    title: 'Natural-language send',
    desc: 'Ask in plain English. MailMan composes the subject and body and shows you a preview first.',
  },
  {
    Icon: ShieldCheck,
    title: 'Draft → preview → confirm',
    desc: 'Nothing leaves your machine until you say “yes.” confirm_send is the only tool that dispatches — and it’s idempotent.',
  },
  {
    Icon: Paperclip,
    title: 'Attachments & globs',
    desc: 'Attach files, whole folders, or wildcard patterns like *.pdf — with a 25 MB size guard and a preview of what attaches.',
  },
  {
    Icon: Clock,
    title: 'Scheduled sends',
    desc: '“Send tomorrow at 9am.” An OS-level timer fires it even if your AI tool is closed.',
  },
  {
    Icon: Inbox,
    title: 'Read & search inbox',
    desc: 'List recent mail, read full messages, and search by sender, subject, date or has:attachment.',
  },
  {
    Icon: Users,
    title: 'Contacts & suggestions',
    desc: 'Everyone you email is remembered. Say “email John” and get ranked, fuzzy-matched suggestions.',
  },
  {
    Icon: Bell,
    title: 'Desktop notifications',
    desc: 'A native “email sent” notification after every send — interactive and scheduled. On by default.',
  },
  {
    Icon: Lock,
    title: 'Machine-bound security',
    desc: 'AES-256-GCM over your credentials, master key in the OS keychain. Copy-proof across machines.',
  },
  {
    Icon: Laptop,
    title: 'Cross-OS, pure Node',
    desc: 'Same behavior on macOS, Linux and Windows. Ships as @indianic/mailman on the private registry.',
  },
];

export default function Features() {
  return (
    <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20">
      <Reveal className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Everything email, <span className="text-gradient">hands-free</span>
        </h2>
        <p className="mt-4 text-slate-600 dark:text-slate-300">
          A full email toolkit exposed to your AI assistant — with the safety rails a human would want.
        </p>
      </Reveal>

      <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f, i) => (
          <Reveal key={f.title} delay={(i % 3) * 0.08}>
            <div className="group h-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition duration-300 hover:-translate-y-1 hover:border-brand-300 hover:shadow-xl dark:border-slate-800 dark:bg-slate-900">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-brand-600 transition group-hover:scale-110 dark:bg-brand-900/40 dark:text-brand-300">
                <f.Icon className="h-6 w-6" />
              </div>
              <h3 className="mt-5 text-lg font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{f.desc}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
