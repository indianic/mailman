import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Mail } from './icons.jsx';
import { NPM_URL, PACKAGE, VERSION } from '../config.js';

export default function Footer() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState({ state: 'idle', msg: '' }); // idle | loading | ok | error

  const submit = async (e) => {
    e.preventDefault();
    if (status.state === 'loading') return;
    setStatus({ state: 'loading', msg: '' });
    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setStatus({ state: 'ok', msg: data.message });
        setEmail('');
      } else {
        setStatus({ state: 'error', msg: data.error || 'Subscription failed.' });
      }
    } catch {
      setStatus({ state: 'error', msg: 'Network error — try again.' });
    }
  };

  return (
    <footer className="border-t border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950">
      <div className="mx-auto max-w-6xl px-5 py-14">
        <div className="grid gap-10 md:grid-cols-2 md:items-start">
          {/* Brand + subscribe */}
          <div>
            <div className="flex items-center gap-2 text-lg font-bold">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-fuchsia-500 text-white shadow-sm">
                <Mail className="h-[18px] w-[18px]" />
              </span>
              <span className="text-gradient">MailMan</span>
            </div>
            <p className="mt-3 max-w-sm text-sm text-slate-600 dark:text-slate-400">
              Get product updates and release notes. One short email when something ships — no spam.
            </p>

            <form onSubmit={submit} className="mt-5 max-w-md" noValidate>
              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  aria-label="Email address"
                  className="w-full rounded-full border border-slate-300 bg-white px-5 py-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
                <button
                  type="submit"
                  disabled={status.state === 'loading'}
                  className="shrink-0 rounded-full bg-brand-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
                >
                  {status.state === 'loading' ? 'Subscribing…' : 'Subscribe'}
                </button>
              </div>
              <AnimatePresence>
                {status.msg && (
                  <motion.p
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className={`mt-3 text-sm ${
                      status.state === 'ok'
                        ? 'text-green-600 dark:text-green-400'
                        : 'text-red-600 dark:text-red-400'
                    }`}
                  >
                    {status.msg}
                  </motion.p>
                )}
              </AnimatePresence>
            </form>
          </div>

          {/* Links */}
          <div className="flex flex-wrap gap-x-16 gap-y-8 md:justify-end">
            <div>
              <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Product</h4>
              <ul className="mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-400">
                <li><a href="/#what" className="transition hover:text-brand-600 dark:hover:text-brand-300">What is it</a></li>
                <li><a href="/#features" className="transition hover:text-brand-600 dark:hover:text-brand-300">Features</a></li>
                <li><a href="/#works-with" className="transition hover:text-brand-600 dark:hover:text-brand-300">Works with</a></li>
                <li><a href="/#faq" className="transition hover:text-brand-600 dark:hover:text-brand-300">FAQ</a></li>
                <li><a href="/#install" className="transition hover:text-brand-600 dark:hover:text-brand-300">Install</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Resources</h4>
              <ul className="mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-400">
                <li>
                  <a href={NPM_URL} target="_blank" rel="noopener noreferrer" className="transition hover:text-brand-600 dark:hover:text-brand-300">
                    npm registry ↗
                  </a>
                </li>
                <li><a href="/#install" className="transition hover:text-brand-600 dark:hover:text-brand-300">Install guide</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Legal</h4>
              <ul className="mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-400">
                <li><Link to="/privacy" className="transition hover:text-brand-600 dark:hover:text-brand-300">Privacy Policy</Link></li>
                <li><Link to="/terms" className="transition hover:text-brand-600 dark:hover:text-brand-300">Terms of Service</Link></li>
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-slate-200 pt-6 text-sm text-slate-500 dark:border-slate-800 sm:flex-row">
          <p>
            © {new Date().getFullYear()} IndiaNIC ·{' '}
            <a href={NPM_URL} target="_blank" rel="noopener noreferrer" className="transition hover:text-brand-600 dark:hover:text-brand-300">
              {PACKAGE}@{VERSION}
            </a>
          </p>
          <p>Built with MailMan 💜</p>
        </div>
      </div>
    </footer>
  );
}
