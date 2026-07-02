import Reveal from './Reveal.jsx';
import { Mail, ICONS } from './icons.jsx';
import { useContent } from '../ContentContext.jsx';

/*
 * Apple-style floating app-icon cluster: a central MailMan orb with gradient
 * "app tile" bubbles gently bobbing around it (animate-float, varied
 * duration/delay for an organic feel). Pure decoration that says "MailMan sits
 * at the center of the tools you use." Respects prefers-reduced-motion.
 */

// DB-backed (site_content.constellation); fallback only.
const FALLBACK = [
  { top: '8%', left: '50%', size: 70, grad: 'from-blue-400 to-blue-600', icon: 'mail', label: 'Send email', dur: 6, delay: 0 },
  { top: '24%', left: '20%', size: 62, grad: 'from-amber-400 to-orange-500', icon: 'sparkle', label: 'Claude', dur: 7, delay: 0.6 },
  { top: '20%', left: '80%', size: 58, grad: 'from-sky-400 to-blue-600', icon: 'sparkle', label: 'Gemini', dur: 6.5, delay: 1.1 },
  { top: '50%', left: '11%', size: 56, grad: 'from-slate-600 to-slate-800', icon: 'cursor', label: 'Cursor', dur: 8, delay: 0.3 },
  { top: '48%', left: '89%', size: 60, grad: 'from-emerald-400 to-teal-600', icon: 'openai', label: 'OpenAI', dur: 7.5, delay: 0.9 },
  { top: '80%', left: '24%', size: 58, grad: 'from-violet-500 to-purple-700', icon: 'paperclip', label: 'Attachments', dur: 6.8, delay: 1.4 },
  { top: '82%', left: '76%', size: 60, grad: 'from-rose-400 to-pink-600', icon: 'clock', label: 'Schedule', dur: 7.2, delay: 0.4 },
  { top: '90%', left: '50%', size: 56, grad: 'from-indigo-400 to-indigo-600', icon: 'inbox', label: 'Read inbox', dur: 6.2, delay: 1.7 },
];

function Tile({ top, left, size, grad, icon, label, dur, delay }) {
  const Icon = ICONS[icon] || Mail;
  const labelAbove = parseFloat(top) > 66; // keep labels inside the box near the bottom
  const Label = (
    <span className="whitespace-nowrap text-xs font-semibold text-slate-600 dark:text-slate-300">
      {label}
    </span>
  );
  const tile = (
    <div
      className={`flex items-center justify-center rounded-[28%] bg-gradient-to-br shadow-lg shadow-slate-900/10 ring-1 ring-black/5 ${grad}`}
      style={{ width: size, height: size }}
    >
      <Icon className="h-1/2 w-1/2 text-white" />
    </div>
  );
  return (
    <div
      className="animate-float absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2"
      style={{ top, left, animationDuration: `${dur}s`, animationDelay: `${delay}s` }}
    >
      {labelAbove ? (<>{Label}{tile}</>) : (<>{tile}{Label}</>)}
    </div>
  );
}

export default function Constellation() {
  const TILES = useContent('constellation', FALLBACK);
  return (
    <section className="mx-auto max-w-6xl px-5 py-20">
      <Reveal className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
          At the center of your <span className="text-gradient">workflow</span>
        </h2>
        <p className="mt-4 text-slate-600 dark:text-slate-300">
          MailMan sits between the AI tools you already use and the email you already have —
          one calm hub for sending, reading, scheduling and more.
        </p>
      </Reveal>

      <Reveal delay={0.1}>
        <div className="relative mx-auto mt-8 h-[440px] max-w-3xl sm:h-[520px]">
          {/* soft radial backdrop */}
          <div className="pointer-events-none absolute left-1/2 top-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-tr from-brand-400/25 to-fuchsia-400/20 blur-3xl" />

          {/* floating app tiles */}
          {TILES.map((t, i) => (
            <Tile key={i} {...t} />
          ))}

          {/* central MailMan orb */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <div className="relative">
              <span className="absolute inset-0 animate-ping rounded-full bg-brand-400/30" style={{ animationDuration: '3s' }} />
              <div className="relative flex h-32 w-32 flex-col items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-fuchsia-500 text-white shadow-2xl ring-8 ring-white dark:ring-slate-950">
                <Mail className="h-10 w-10" />
                <span className="mt-1 text-sm font-bold tracking-tight">MailMan</span>
              </div>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
