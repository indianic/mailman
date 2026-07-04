import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import ThemeToggle from './ThemeToggle.jsx';
import { GitHub } from './icons.jsx';
import BrandMark from './BrandMark.jsx';
import { GITHUB_URL } from '../config.js';

const NAV = [
  { label: 'What is it', href: '/#what' },
  { label: 'Features', href: '/#features' },
  { label: 'Works with', href: '/#works-with' },
  { label: 'How to use', href: '/#how-to-use' },
  { label: 'Examples', href: '/#examples' },
  { label: 'Install', href: '/#install' },
  { label: 'Setup', href: '/#setup' },
];

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'border-b border-slate-200/70 bg-white/80 backdrop-blur-md dark:border-slate-800/70 dark:bg-slate-950/80'
          : 'border-b border-transparent'
      }`}
    >
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
        <Link to="/" className="flex items-center gap-2 text-lg font-bold tracking-tight">
          <BrandMark className="h-8 w-8" />
          <span className="text-gradient">MailMan</span>
        </Link>

        <div className="hidden items-center gap-6 lg:flex">
          {NAV.map((n) => (
            <a
              key={n.label}
              href={n.href}
              className="text-sm font-medium text-slate-600 transition hover:text-brand-600 dark:text-slate-300 dark:hover:text-brand-300"
            >
              {n.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-3">
          {pathname !== '/' && (
            <Link
              to="/"
              className="hidden text-sm font-medium text-slate-600 transition hover:text-brand-600 dark:text-slate-300 sm:inline"
            >
              ← Home
            </Link>
          )}
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="View mailman source on GitHub"
            title="View source on GitHub"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white/70 text-slate-600 transition hover:border-brand-400 hover:text-brand-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300 dark:hover:text-brand-300"
          >
            <GitHub className="h-[18px] w-[18px]" />
          </a>
          <a
            href="/#install"
            className="hidden rounded-full bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 sm:inline-block"
          >
            Get started
          </a>
          <ThemeToggle />
        </div>
      </nav>
    </header>
  );
}
