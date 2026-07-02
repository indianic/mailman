import Reveal from './Reveal.jsx';
import { MessageSquare, Inbox, Clock, Paperclip } from './icons.jsx';

const GROUPS = [
  {
    Icon: MessageSquare,
    title: 'Send',
    examples: [
      '“Email the Q3 report to sandeep@indianic.com.”',
      '“Reply to the last email from finance and say I approve.”',
      '“Send a thank-you note to everyone on yesterday’s call.”',
    ],
  },
  {
    Icon: Inbox,
    title: 'Read & search',
    examples: [
      '“Show my last 10 emails.”',
      '“Any unread mail from Priya this week?”',
      '“Find the invoice with an attachment from March.”',
    ],
  },
  {
    Icon: Clock,
    title: 'Schedule',
    examples: [
      '“Send this tomorrow at 9am.”',
      '“Schedule the newsletter for Monday morning.”',
      '“What sends do I have queued?”',
    ],
  },
  {
    Icon: Paperclip,
    title: 'Attach',
    examples: [
      '“Attach all the PDFs in ~/reports and send to the team.”',
      '“Send the deck folder to Aadil.”',
      '“What would *.png in this folder attach?”',
    ],
  },
];

export default function HowToUse() {
  return (
    <section id="how-to-use" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20">
      <Reveal className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
          How to <span className="text-gradient">use it</span>
        </h2>
        <p className="mt-4 text-slate-600 dark:text-slate-300">
          Once it’s installed, you just talk to your AI. Here’s the kind of thing you can say —
          in your own words, no special syntax.
        </p>
      </Reveal>

      <div className="mt-14 grid gap-6 sm:grid-cols-2">
        {GROUPS.map((g, i) => (
          <Reveal key={g.title} delay={(i % 2) * 0.08}>
            <div className="h-full rounded-2xl border border-slate-200 bg-white p-7 shadow-sm transition duration-300 hover:-translate-y-1 hover:border-brand-300 hover:shadow-xl dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
                  <g.Icon className="h-6 w-6" />
                </span>
                <h3 className="text-lg font-semibold">{g.title}</h3>
              </div>
              <ul className="mt-5 space-y-3">
                {g.examples.map((ex) => (
                  <li
                    key={ex}
                    className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-2.5 text-sm italic text-slate-600 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-300"
                  >
                    {ex}
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
