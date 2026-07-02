import Reveal from './Reveal.jsx';

const STEPS = [
  {
    n: '01',
    title: 'You ask',
    desc: '“MailMan, send the checklist to Kalpesh.” Your AI resolves the file and composes the message.',
  },
  {
    n: '02',
    title: 'You preview',
    desc: 'MailMan drafts it and shows exactly what will go out — From, To, Subject, attachments, signature.',
  },
  {
    n: '03',
    title: 'You confirm',
    desc: 'Say “send it.” Only then does confirm_send dispatch — with a desktop notification to close the loop.',
  },
];

export default function HowItWorks() {
  return (
    <section
      id="how"
      className="scroll-mt-20 border-y border-slate-200 bg-slate-50 py-20 dark:border-slate-800 dark:bg-slate-900/40"
    >
      <div className="mx-auto max-w-6xl px-5">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            The safety flow, in <span className="text-gradient">three steps</span>
          </h2>
          <p className="mt-4 text-slate-600 dark:text-slate-300">
            MailMan never sends the moment you ask. It always drafts, previews, then waits for your OK.
          </p>
        </Reveal>

        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={i * 0.1}>
              <div className="relative h-full rounded-2xl border border-slate-200 bg-white p-7 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <span className="font-mono text-4xl font-bold text-brand-200 dark:text-brand-800">
                  {s.n}
                </span>
                <h3 className="mt-3 text-lg font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{s.desc}</p>
                {i < STEPS.length - 1 && (
                  <span className="absolute right-5 top-8 hidden text-2xl text-brand-300 md:block">→</span>
                )}
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
