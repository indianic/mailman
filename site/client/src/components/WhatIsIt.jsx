import Reveal from './Reveal.jsx';
import { Bot, Terminal } from './icons.jsx';

export default function WhatIsIt() {
  return (
    <section id="what" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20">
      <Reveal className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
          What is <span className="text-gradient">MailMan</span>?
        </h2>
        <p className="mt-4 text-slate-600 dark:text-slate-300">
          One idea, explained for whoever’s reading — whether you write code or not.
        </p>
      </Reveal>

      <div className="mt-14 grid gap-6 md:grid-cols-2">
        {/* Non-technical */}
        <Reveal>
          <div className="h-full rounded-2xl border border-brand-200 bg-brand-50/60 p-8 dark:border-brand-800/60 dark:bg-brand-900/20">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-semibold text-brand-700 dark:bg-slate-900 dark:text-brand-300">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-500" /> In plain words
            </div>
            <p className="text-lg leading-relaxed text-slate-700 dark:text-slate-200">
              MailMan lets you <strong>send and read email just by asking your AI
              assistant</strong> — <em>“send those docs to Kalpesh,”</em>{' '}
              <em>“show my last 10 emails,”</em> <em>“reply politely and decline.”</em>
            </p>
            <p className="mt-4 leading-relaxed text-slate-600 dark:text-slate-300">
              You set it up once. After that, you just talk — no menus, no copy-paste,
              no leaving your chat. And it always shows you the email <strong>before</strong>{' '}
              it sends, so you’re never surprised.
            </p>
          </div>
        </Reveal>

        {/* Technical */}
        <Reveal delay={0.1}>
          <div className="h-full rounded-2xl border border-slate-200 bg-slate-900 p-8 text-slate-200 dark:border-slate-800">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-slate-800 px-3 py-1 text-xs font-semibold text-brand-300">
              <span className="h-1.5 w-1.5 rounded-full bg-fuchsia-400" /> Under the hood
            </div>
            <p className="text-lg leading-relaxed">
              MailMan is a <strong className="text-white">Node.js MCP server</strong>{' '}
              (Model Context Protocol). Your AI tool launches it over a pipe
              (<code className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-sm text-brand-200">npx -y @indianic/mailman</code>)
              and calls its tools from natural language.
            </p>
            <p className="mt-4 leading-relaxed text-slate-300">
              It reaches Gmail two ways — <strong className="text-white">SMTP/IMAP</strong>{' '}
              for App Password accounts, or the <strong className="text-white">Gmail REST
              API</strong> for OAuth2. Pure Node, so behavior is identical across
              operating systems. Every tool returns plain JSON, so any MCP host renders it.
            </p>
          </div>
        </Reveal>
      </div>

      {/* Two front doors */}
      <Reveal delay={0.15} className="mt-8">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="text-center text-xl font-bold">Two ways to use it</h3>
          <p className="mx-auto mt-2 max-w-2xl text-center text-sm text-slate-600 dark:text-slate-400">
            Everyday email goes through your AI. Anything sensitive stays in your own hands.
          </p>
          <div className="mt-8 grid gap-6 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 p-6 dark:border-slate-800">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
                <Bot className="h-6 w-6" />
              </div>
              <h4 className="mt-3 font-semibold">The AI door</h4>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                Your assistant sends, reads, searches and schedules email on your behalf —
                the everyday stuff. An AI never touches your credentials.
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 p-6 dark:border-slate-800">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                <Terminal className="h-6 w-6" />
              </div>
              <h4 className="mt-3 font-semibold">The terminal door</h4>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                You type <code className="rounded bg-slate-100 px-1 font-mono text-xs dark:bg-slate-800">mailman …</code>{' '}
                yourself for setup, accounts, diagnostics and credentials — the sensitive stuff.
              </p>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
