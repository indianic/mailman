import { useEffect } from 'react';

// Shared shell for the policy pages: scrolls to top on mount and applies
// readable prose spacing without pulling in a typography plugin.
export default function LegalLayout({ title, updated, children }) {
  useEffect(() => window.scrollTo(0, 0), []);
  return (
    <div className="mx-auto max-w-3xl px-5 py-16">
      <p className="text-sm font-semibold text-brand-600 dark:text-brand-400">Legal</p>
      <h1 className="mt-2 text-4xl font-extrabold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Last updated: {updated}</p>
      <div className="mt-10 space-y-6 text-[15px] leading-relaxed text-slate-700 dark:text-slate-300 [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-slate-900 dark:[&_h2]:text-slate-100 [&_a]:text-brand-600 [&_a]:underline dark:[&_a]:text-brand-400 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6">
        {children}
      </div>
    </div>
  );
}
