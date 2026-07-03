import Reveal from './Reveal.jsx';
import { Mail } from './icons.jsx';

/*
 * "How it works" centerpiece: a realistic IDE / terminal window showing a live
 * MailMan session (ask → draft/preview → confirm → done). Transcript content is
 * always visible (no scroll-gated per-line animation, which left it half-blank);
 * life comes from the outer reveal, the blinking caret, and the floating
 * "email sent" notification.
 */

function Prompt({ children }) {
  return (
    <div className="font-mono text-[13.5px] leading-relaxed">
      <span className="text-brand-400">you ›</span> <span className="text-slate-100">{children}</span>
    </div>
  );
}

// diamond-tree lines (MailMan CLI convention)
const Top = () => <div className="font-mono text-[13.5px] text-slate-600">┌</div>;
const Section = ({ children }) => (
  <div className="font-mono text-[13.5px] leading-relaxed">
    <span className="text-cyan-400">◆</span> <span className="font-semibold text-slate-200">{children}</span>
  </div>
);
const Status = ({ children }) => (
  <div className="font-mono text-[13.5px] leading-relaxed">
    <span className="text-emerald-400">◇</span> <span className="text-slate-300">{children}</span>
  </div>
);
const Rail = ({ children }) => (
  <div className="font-mono text-[13.5px] leading-relaxed">
    <span className="text-slate-600">│</span>   <span className="text-slate-400">{children}</span>
  </div>
);
const End = ({ children }) => (
  <div className="font-mono text-[13.5px] leading-relaxed">
    <span className="text-slate-600">└</span>  <span className="font-semibold text-emerald-400">{children}</span>
  </div>
);

export default function Workbench() {
  return (
    <section id="flow" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20">
      <Reveal className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
          How it <span className="text-gradient">works</span>
        </h2>
        <p className="mt-4 text-slate-600 dark:text-slate-300">
          You stay in your editor and just talk. MailMan drafts, shows you a preview, and only
          sends on your OK — then pings you it’s done.
        </p>
      </Reveal>

      <Reveal delay={0.1} className="relative mt-12">
        {/* ambient glow behind the window */}
        <div className="pointer-events-none absolute inset-x-10 -top-6 bottom-0 -z-10 rounded-[2rem] bg-gradient-to-tr from-brand-500/20 via-fuchsia-500/10 to-transparent blur-2xl" />

        <div className="mx-auto max-w-4xl overflow-hidden rounded-2xl border border-slate-700/60 bg-slate-900 shadow-2xl ring-1 ring-black/5">
          {/* title bar */}
          <div className="flex items-center gap-2 border-b border-slate-700/60 bg-slate-800/60 px-4 py-3">
            <span className="h-3 w-3 rounded-full bg-red-400" />
            <span className="h-3 w-3 rounded-full bg-yellow-400" />
            <span className="h-3 w-3 rounded-full bg-green-400" />
            <span className="mx-auto flex items-center gap-2 font-mono text-xs text-slate-400">
              <Mail className="h-3.5 w-3.5" /> claude · MailMan — ~/acme-app
            </span>
          </div>

          <div>
            {/* transcript — diamond-tree convention */}
            <div className="space-y-1.5 p-5 sm:p-7">
              <Prompt>MailMan, send the Q3 report to kalpesh.gamit@indianic.com</Prompt>
              <Top />
              <Section>draft — preview</Section>
              <Rail>to · kalpesh.gamit@indianic.com</Rail>
              <Rail>subject · Q3 Report</Rail>
              <Rail>Q3-report.pdf (84 KB) · signature appended</Rail>
              <Status>send it</Status>
              <End>sent · desktop notification shown</End>

              <div className="pt-3" />

              <Prompt>any unread from finance this week?</Prompt>
              <Top />
              <Section>inbox — Finance (3 unread)</Section>
              <Rail>Reimbursement approved</Rail>
              <Rail>Q3 budget sign-off</Rail>
              <Rail>Invoice #4412</Rail>
              <End>ready</End>

              {/* live caret */}
              <div className="flex items-center gap-2 pt-2 font-mono text-[13.5px]">
                <span className="text-brand-400">you ›</span>
                <span className="inline-block h-4 w-[8px] animate-pulse rounded-[1px] bg-slate-300" />
              </div>
            </div>
          </div>
        </div>

        {/* floating notification — styled like a real macOS banner (CSS-only
            entrance so it always ends visible) */}
        <div className="notif absolute -right-2 top-16 w-[320px] rounded-[18px] bg-white/70 p-3.5 shadow-2xl ring-1 ring-black/5 backdrop-blur-2xl dark:bg-slate-800/70 dark:ring-white/10 sm:right-6">
          <div className="flex items-start gap-3">
            {/* app icon */}
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[22%] bg-gradient-to-br from-brand-500 to-fuchsia-500 text-white shadow-sm">
              <Mail className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[15px] font-semibold text-slate-900 dark:text-white">MailMan</span>
                <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">now</span>
              </div>
              <p className="mt-0.5 text-[13.5px] leading-snug text-slate-700 dark:text-slate-200">
                Email sent to Kalpesh Gamit
              </p>
              <p className="text-[13.5px] leading-snug text-slate-500 dark:text-slate-400">
                “Q3 Report” · delivered ✓
              </p>
            </div>
          </div>
        </div>
      </Reveal>

      {/* 3 steps */}
      <Reveal delay={0.15} className="mt-10 grid gap-4 sm:grid-cols-3">
        {[
          { n: '1', t: 'Ask your AI', d: 'In plain English, in the editor you already use.' },
          { n: '2', t: 'Preview & confirm', d: 'MailMan drafts it and waits for your OK — nothing sends on its own.' },
          { n: '3', t: 'Delivered', d: 'Sent over Gmail SMTP/IMAP, with a desktop ping back.' },
        ].map((s) => (
          <div key={s.n} className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">{s.n}</div>
            <h3 className="mt-3 font-semibold">{s.t}</h3>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{s.d}</p>
          </div>
        ))}
      </Reveal>
    </section>
  );
}
