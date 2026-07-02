import Reveal from './Reveal.jsx';
import { Sparkle, Cursor, Wave, Code, OpenAI, Apple, Linux, Windows } from './icons.jsx';

const AI_TOOLS = [
  { name: 'Claude', Icon: Sparkle, color: 'text-orange-500' },
  { name: 'Gemini', Icon: Sparkle, color: 'text-blue-500' },
  { name: 'OpenAI', Icon: OpenAI, color: 'text-emerald-600 dark:text-emerald-400' },
  { name: 'Cursor', Icon: Cursor, color: 'text-slate-700 dark:text-slate-200' },
  { name: 'Windsurf', Icon: Wave, color: 'text-teal-500' },
  { name: 'Codex', Icon: Code, color: 'text-violet-500' },
];

const PLATFORMS = [
  { name: 'macOS', Icon: Apple, note: 'Verified end-to-end', color: 'text-slate-800 dark:text-slate-100' },
  { name: 'Linux', Icon: Linux, note: 'Verified (Docker)', color: 'text-slate-800 dark:text-slate-100' },
  { name: 'Windows', Icon: Windows, note: 'Supported, pure Node', color: 'text-sky-500' },
];

export default function Compatibility() {
  return (
    <section
      id="works-with"
      className="scroll-mt-20 border-y border-slate-200 bg-slate-50 py-20 dark:border-slate-800 dark:bg-slate-900/40"
    >
      <div className="mx-auto max-w-6xl px-5">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Works with your <span className="text-gradient">tools & your OS</span>
          </h2>
          <p className="mt-4 text-slate-600 dark:text-slate-300">
            One install, wired into whatever AI editor you already use — on whatever
            machine you’re on. <code className="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-sm dark:bg-slate-800">mailman register</code> sets it up (idempotent — safe to re-run).
          </p>
        </Reveal>

        {/* AI tools */}
        <Reveal delay={0.05} className="mt-14">
          <p className="text-center text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            Supported AI tools
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
            {AI_TOOLS.map((t) => (
              <div
                key={t.name}
                className="flex items-center gap-2.5 rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold shadow-sm transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md dark:border-slate-700 dark:bg-slate-900"
              >
                <t.Icon className={`h-5 w-5 ${t.color}`} />
                {t.name}
              </div>
            ))}
          </div>
        </Reveal>

        {/* Platforms */}
        <Reveal delay={0.1} className="mt-12">
          <p className="text-center text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            Runs natively on
          </p>
          <div className="mx-auto mt-6 grid max-w-3xl gap-4 sm:grid-cols-3">
            {PLATFORMS.map((p) => (
              <div
                key={p.name}
                className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm transition hover:-translate-y-1 hover:shadow-md dark:border-slate-700 dark:bg-slate-900"
              >
                <div className="flex justify-center">
                  <p.Icon className={`h-9 w-9 ${p.color}`} />
                </div>
                <h3 className="mt-3 text-lg font-semibold">{p.name}</h3>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{p.note}</p>
              </div>
            ))}
          </div>
          <p className="mx-auto mt-8 max-w-xl text-center text-sm text-slate-500 dark:text-slate-400">
            Same behavior everywhere — it’s pure Node.js. Credentials are stored in each
            OS’s native keychain (Keychain, Secret Service, Credential Manager).
          </p>
        </Reveal>
      </div>
    </section>
  );
}
