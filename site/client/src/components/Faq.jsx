import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Reveal from './Reveal.jsx';
import { Plus } from './icons.jsx';
import { useContent } from '../ContentContext.jsx';

const FALLBACK = [
  {
    q: 'Do I need to be technical to use it?',
    a: 'No. A developer (or the setup wizard) installs it once. After that you just talk to your AI assistant in plain English — “email this to Sana,” “what did I get from finance today?”',
  },
  {
    q: 'Is my email account safe?',
    a: 'Yes. Your credentials are encrypted with AES-256-GCM and the key lives in your operating system’s keychain — never in a plain file and never uploaded to us. Copying the config to another machine yields useless ciphertext.',
  },
  {
    q: 'Will it send an email without my permission?',
    a: 'Never. Every send follows draft → preview → confirm. MailMan prepares the message, shows you exactly what will go out, and only sends after you say “yes.”',
  },
  {
    q: 'Which email providers work?',
    a: 'Gmail today — via a simple App Password (recommended) or OAuth2 for Workspace setups. Sending uses SMTP; reading and search use IMAP or the Gmail API.',
  },
  {
    q: 'What happens if I close my AI tool?',
    a: 'Scheduled emails still go out. The first time you schedule something, MailMan installs an OS-level timer (launchd, cron, or Task Scheduler) that fires independently of your editor.',
  },
  {
    q: 'How do I get it / how is it distributed?',
    a: 'It ships as @indianic/mailman on the IndiaNIC private npm registry. Install globally, run mailman init, then mailman register to wire it into your AI editor.',
  },
];

function Item({ q, a, open, onToggle }) {
  return (
    <div className="border-b border-slate-200 dark:border-slate-800">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-4 py-5 text-left"
      >
        <span className="font-semibold">{q}</span>
        <span
          className={`shrink-0 text-brand-500 transition-transform duration-300 ${
            open ? 'rotate-45' : ''
          }`}
        >
          <Plus className="h-5 w-5" />
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <p className="pb-5 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function Faq() {
  const FAQS = useContent('faqs', FALLBACK);
  const [open, setOpen] = useState(0);
  return (
    <section id="faq" className="mx-auto max-w-3xl scroll-mt-20 px-5 py-20">
      <Reveal className="text-center">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Common <span className="text-gradient">questions</span>
        </h2>
        <p className="mt-4 text-slate-600 dark:text-slate-300">
          Everything you’d ask before trying it.
        </p>
      </Reveal>

      <Reveal delay={0.1} className="mt-10">
        {FAQS.map((f, i) => (
          <Item
            key={f.q}
            {...f}
            open={open === i}
            onToggle={() => setOpen(open === i ? -1 : i)}
          />
        ))}
      </Reveal>
    </section>
  );
}
