import { useState } from 'react';
import Reveal from './Reveal.jsx';
import { Package } from './icons.jsx';
import { NPM_URL } from '../config.js';

const CMDS = [
  { label: 'Install globally', cmd: 'npm install -g @indianic/mailman' },
  { label: 'First-run setup', cmd: 'mailman init' },
  { label: 'Register with your AI editor', cmd: 'mailman register' },
];

function CommandRow({ label, cmd }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — no-op */
    }
  };
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <button
        onClick={copy}
        className="group flex w-full items-center justify-between gap-4 rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-left font-mono text-sm text-slate-200 transition hover:border-brand-500"
      >
        <span className="truncate">
          <span className="mr-2 text-brand-400">$</span>
          {cmd}
        </span>
        <span className="shrink-0 text-xs font-sans font-semibold text-slate-400 transition group-hover:text-brand-300">
          {copied ? 'Copied ✓' : 'Copy'}
        </span>
      </button>
    </div>
  );
}

export default function Install() {
  return (
    <section id="install" className="mx-auto max-w-3xl scroll-mt-20 px-5 py-20">
      <Reveal className="text-center">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Up and running in <span className="text-gradient">three commands</span>
        </h2>
        <p className="mt-4 text-slate-600 dark:text-slate-300">
          Requires Node 18+. Distributed as{' '}
          <a
            href={NPM_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm text-brand-600 underline decoration-brand-300 underline-offset-2 hover:decoration-brand-500 dark:bg-slate-800 dark:text-brand-300"
          >
            @indianic/mailman
          </a>{' '}
          on the IndiaNIC private registry.
        </p>

        <a
          href={NPM_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-6 inline-flex items-center gap-2 rounded-full border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:-translate-y-0.5 hover:border-brand-400 hover:text-brand-600 dark:border-slate-700 dark:text-slate-200 dark:hover:text-brand-300"
        >
          <Package className="h-[18px] w-[18px]" />
          View on npm registry
          <span aria-hidden="true">↗</span>
        </a>
      </Reveal>

      <Reveal delay={0.1} className="mt-10 space-y-5">
        {CMDS.map((c) => (
          <CommandRow key={c.label} {...c} />
        ))}
      </Reveal>
    </section>
  );
}
