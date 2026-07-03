import Reveal from './Reveal.jsx';
import { ICONS } from './icons.jsx';
import { useContent } from '../ContentContext.jsx';

// Fallback if /api/content is unreachable — DB (site_content.features) is the
// source of truth and editable there.
const FALLBACK = [
  { icon: 'messageSquare', title: 'Natural-language send', desc: 'Ask in plain English. MailMan composes the subject and body and shows you a preview first.' },
  { icon: 'sparkle', title: '182 message templates', desc: 'FYI, follow-up, meeting, status, forward/reply and 175+ more — each a subject prefix + a hint your AI composes from. Browse with list_templates.' },
  { icon: 'shieldCheck', title: 'Draft → preview → confirm', desc: 'Nothing leaves your machine until you approve it. confirm_send won’t dispatch without an explicit confirmation — and it’s idempotent.' },
  { icon: 'paperclip', title: 'Attachments & globs', desc: 'Attach files, whole folders, or wildcard patterns like *.pdf — with a 25 MB size guard and a preview of what attaches.' },
  { icon: 'clock', title: 'Scheduled sends', desc: '“Send tomorrow at 9am.” An OS-level timer fires it even if your AI tool is closed.' },
  { icon: 'inbox', title: 'Read & search inbox', desc: 'List recent mail, read full messages, and search by sender, subject, date or has:attachment.' },
  { icon: 'users', title: 'Contacts & suggestions', desc: 'Everyone you email is remembered. Say “email John” and get ranked, fuzzy-matched suggestions.' },
  { icon: 'bell', title: 'Desktop notifications', desc: 'A native “email sent” notification after every send — interactive and scheduled. On by default.' },
  { icon: 'lock', title: 'Machine-bound security', desc: 'AES-256-GCM over your credentials, master key in the OS keychain. Copy-proof across machines.' },
  { icon: 'laptop', title: 'Cross-OS, pure Node', desc: 'Same behavior on macOS, Linux and Windows. Ships as @indianic/mailman on the private registry.' },
];

// Per-icon gradient palette — gives the icon set a distinctive, branded look.
const GRADS = [
  'from-indigo-500 to-blue-600',
  'from-amber-400 to-orange-500',
  'from-violet-500 to-purple-700',
  'from-rose-400 to-pink-600',
  'from-sky-400 to-cyan-600',
  'from-emerald-400 to-teal-600',
  'from-fuchsia-500 to-purple-600',
  'from-blue-500 to-indigo-700',
  'from-teal-400 to-emerald-600',
];

export default function Features() {
  const features = useContent('features', FALLBACK);
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
        {features.map((f, i) => {
          const Icon = ICONS[f.icon] || ICONS.mail;
          return (
            <Reveal key={f.title} delay={(i % 3) * 0.08}>
              <div className="group h-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition duration-300 hover:-translate-y-1 hover:border-brand-300 hover:shadow-xl dark:border-slate-800 dark:bg-slate-900">
                <div className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-md shadow-slate-900/10 ring-1 ring-black/5 transition duration-300 group-hover:-rotate-6 group-hover:scale-110 ${GRADS[i % GRADS.length]}`}>
                  <Icon className="h-6 w-6" />
                </div>
                <h3 className="mt-5 text-lg font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{f.desc}</p>
              </div>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}
