import { motion } from 'framer-motion';
import { NPM_URL } from '../config.js';
import TerminalCard from './TerminalCard.jsx';
import FlipWords from './FlipWords.jsx';

const HERO_LINES = [
  { role: 'prompt', text: 'MailMan, send the Q3 report to sandeep@indianic.com' },
  { role: 'treetop' },
  { role: 'section', text: 'draft — preview' },
  { role: 'rail', text: 'to · sandeep@indianic.com' },
  { role: 'rail', text: 'subject · Q3 Report' },
  { role: 'rail', text: 'Q3-report.pdf (84 KB) · signature appended' },
  { role: 'status', text: 'send it' },
  { role: 'treeend', text: 'sent · desktop notification shown' },
];

export default function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* ambient grid + glow */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="bg-grid absolute inset-0" />
        <div className="absolute left-1/2 top-[-10rem] h-[28rem] w-[28rem] -translate-x-1/2 rounded-full bg-brand-400/25 blur-3xl dark:bg-brand-600/20" />
        <div className="absolute right-[-6rem] top-40 h-72 w-72 rounded-full bg-fuchsia-400/20 blur-3xl dark:bg-fuchsia-700/20" />
      </div>

      <div className="mx-auto max-w-6xl px-5 pb-20 pt-16 sm:pt-24">
        <div className="mx-auto max-w-3xl text-center">
          <motion.a
            href={NPM_URL}
            target="_blank"
            rel="noopener noreferrer"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700 transition hover:border-brand-400 hover:bg-brand-100 dark:border-brand-800 dark:bg-brand-900/40 dark:text-brand-200 dark:hover:bg-brand-900/70"
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-500" />
            </span>
            v0.5.6 · @indianic/mailman
            <span aria-hidden="true">↗</span>
          </motion.a>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.05 }}
            className="mt-6 text-4xl font-extrabold leading-tight tracking-tight sm:text-6xl"
          >
            Email from your{' '}
            <FlipWords words={['terminal', 'editor', 'AI chat', 'workflow', 'flow']} />
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.12 }}
            className="mx-auto mt-6 max-w-2xl text-lg text-slate-600 dark:text-slate-300"
          >
            Send and read Gmail just by asking — <em>“send those docs to Kalpesh,”</em>{' '}
            <em>“show my last 10 emails.”</em> Nothing sends without your OK.
          </motion.p>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.16 }}
            className="mt-5 text-base font-medium text-slate-500 dark:text-slate-400"
          >
            Runs with{' '}
            <FlipWords
              words={['Claude', 'Gemini', 'OpenAI', 'Cursor', 'Windsurf', 'VS Code']}
              interval={1900}
              colorClass="font-semibold text-brand-600 dark:text-brand-400"
            />{' '}
            on{' '}
            <FlipWords
              words={['macOS', 'Windows', 'Linux']}
              interval={2600}
              colorClass="font-semibold text-fuchsia-600 dark:text-fuchsia-400"
            />
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row"
          >
            <a
              href="#install"
              className="w-full rounded-full bg-brand-600 px-7 py-3 text-center text-sm font-semibold text-white shadow-lg shadow-brand-600/25 transition hover:-translate-y-0.5 hover:bg-brand-700 sm:w-auto"
            >
              Get started
            </a>
            <a
              href="#features"
              className="w-full rounded-full border border-slate-300 px-7 py-3 text-center text-sm font-semibold text-slate-700 transition hover:border-brand-400 hover:text-brand-600 dark:border-slate-700 dark:text-slate-200 dark:hover:text-brand-300 sm:w-auto"
            >
              Explore features
            </a>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, delay: 0.28 }}
            className="mx-auto mt-14 max-w-2xl text-left"
          >
            <TerminalCard title="claude · MailMan" lines={HERO_LINES} />
          </motion.div>
        </div>
      </div>
    </section>
  );
}
