import Reveal from './Reveal.jsx';

/*
 * Single-SVG connection graph (viewBox 0 0 1000 600). Premium/"AI" treatment:
 *  - wires fan out to DISTINCT ports around the hub ring (no tangle at center)
 *  - icons sit on a soft accent glow (no boxes)
 *  - a glowing multi-ring hub with expanding "broadcast" rings
 *  - emerald pulse dots travel along the active wires (animateMotion)
 * Theme-aware via Tailwind fill/stroke; motion respects prefers-reduced-motion.
 */

const CX = 500;
const CY = 300;
const R = 84; // ring where wires attach
const CORE = 60;

const rad = (d) => (d * Math.PI) / 180;
const port = (deg) => ({ x: CX + R * Math.cos(rad(deg)), y: CY + R * Math.sin(rad(deg)) });

// --- line glyphs in 0..24 space (stroke = currentColor) ---------------------
const GLYPHS = {
  sparkle: <path d="M12 3l1.7 4.8L18 9.5l-4.3 1.7L12 16l-1.7-4.8L6 9.5l4.3-1.7z" />,
  cursor: <path d="M6 4l11 6.5-4.6 1.2-1.2 4.6L6 4z" />,
  code: <path d="M9 8l-4 4 4 4M15 8l4 4-4 4" />,
  wave: (
    <>
      <path d="M3 13c2 0 2-2.5 4-2.5s2 2.5 4 2.5 2-2.5 4-2.5 2 2.5 4 2.5" />
      <path d="M3 17c2 0 2-2.5 4-2.5s2 2.5 4 2.5 2-2.5 4-2.5 2 2.5 4 2.5" />
    </>
  ),
  send: <path d="M21 4L11 14M21 4l-6.5 17-3.5-7-7-3.5L21 4z" />,
  inbox: (
    <>
      <path d="M21 12h-5l-2 3h-4l-2-3H3" />
      <path d="M6 5h12l3 7v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5z" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="M20 20l-3.5-3.5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l3 2" />
    </>
  ),
  paperclip: <path d="M20 11l-8 8a5 5 0 0 1-7-7l8-8a3 3 0 0 1 4 4l-8 8a1 1 0 0 1-1.5-1.5l7-7" />,
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M21 7l-9 6-9-6" />
    </>
  ),
};

// nodes: y position, ring-attach angle, icon, active
const CLIENTS = [
  { label: 'Claude Code', icon: 'sparkle', y: 100, deg: 213, active: true },
  { label: 'Cursor', icon: 'cursor', y: 200, deg: 196, active: false },
  { label: 'VS Code', icon: 'code', y: 300, deg: 180, active: false },
  { label: 'Gemini CLI', icon: 'sparkle', y: 400, deg: 164, active: false },
  { label: 'Windsurf', icon: 'wave', y: 500, deg: 147, active: true },
];
const CAPS = [
  { label: 'Send email', icon: 'send', y: 90, deg: -41, active: true },
  { label: 'Read inbox', icon: 'inbox', y: 174, deg: -25, active: false },
  { label: 'Search mail', icon: 'search', y: 258, deg: -8, active: false },
  { label: 'Schedule send', icon: 'clock', y: 342, deg: 8, active: true },
  { label: 'Attachments', icon: 'paperclip', y: 426, deg: 25, active: false },
  { label: 'Gmail SMTP / IMAP', icon: 'mail', y: 510, deg: 41, active: false },
];

const L_EDGE = 250; // wires start just right of the left labels
const R_EDGE = 750; // wires end just left of the right icons
const LX = 44;
const RX = 756;

function Glyph({ name, cx, cy, size = 26, strokeWidth = 2.1, className }) {
  const s = size / 24;
  return (
    <g
      transform={`translate(${cx - size / 2}, ${cy - size / 2}) scale(${s})`}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {GLYPHS[name]}
    </g>
  );
}

function Node({ x, y, label, icon, active }) {
  const accent = active ? 'text-emerald-500' : 'text-brand-500 dark:text-brand-300';
  return (
    <g className="group" style={{ cursor: 'default' }}>
      {/* soft glow behind icon (no box) */}
      <circle
        cx={x + 16}
        cy={y}
        r="13"
        filter="url(#iconGlow)"
        className={active ? 'fill-emerald-400/30' : 'fill-brand-400/18'}
      />
      <Glyph name={icon} cx={x + 16} cy={y} size={26} className={accent} />
      <text
        x={x + 42}
        y={y}
        dominantBaseline="middle"
        className="fill-slate-800 text-[16px] font-semibold transition-[fill] group-hover:fill-brand-600 dark:fill-slate-100 dark:group-hover:fill-brand-300"
      >
        {label}
      </text>
    </g>
  );
}

function Pulse({ id, dur, delay }) {
  // opacity starts at 0 so the dot isn't parked at SVG origin (0,0) before its
  // delayed motion begins; <set> reveals it exactly when the motion starts.
  return (
    <circle r="3.2" className="fill-emerald-400" opacity="0">
      <set attributeName="opacity" to="1" begin={`${delay}s`} />
      <animateMotion dur={`${dur}s`} begin={`${delay}s`} repeatCount="indefinite">
        <mpath href={`#${id}`} />
      </animateMotion>
    </circle>
  );
}

export default function FlowDiagram() {
  const leftPaths = CLIENTS.map((n, i) => {
    const p = port(n.deg);
    return {
      id: `lp${i}`,
      active: n.active,
      port: p,
      d: `M${L_EDGE} ${n.y} C ${L_EDGE + 130} ${n.y}, ${p.x - 70} ${p.y}, ${p.x} ${p.y}`,
    };
  });
  const rightPaths = CAPS.map((n, i) => {
    const p = port(n.deg);
    return {
      id: `rp${i}`,
      active: n.active,
      port: p,
      d: `M${R_EDGE} ${n.y} C ${R_EDGE - 130} ${n.y}, ${p.x + 70} ${p.y}, ${p.x} ${p.y}`,
    };
  });
  const all = [...leftPaths, ...rightPaths];

  return (
    <section id="flow" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20">
      <Reveal className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
          How it <span className="text-gradient">works</span>
        </h2>
        <p className="mt-4 text-slate-600 dark:text-slate-300">
          Your AI tool talks to MailMan over MCP. MailMan does the email work and reaches Gmail —
          one hub between whatever editor you use and your inbox.
        </p>
      </Reveal>

      <Reveal delay={0.1} className="mt-10">
        <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-b from-white to-slate-50 p-4 shadow-sm dark:border-slate-800 dark:from-slate-900 dark:to-slate-950 sm:p-8">
          <svg viewBox="0 0 1000 600" className="w-full" role="img" aria-label="MailMan connects AI clients to email actions">
            <defs>
              <radialGradient id="hubCore" cx="34%" cy="28%" r="80%">
                <stop offset="0%" stopColor="#c7d2fe" />
                <stop offset="42%" stopColor="#6366f1" />
                <stop offset="100%" stopColor="#a21caf" />
              </radialGradient>
              <radialGradient id="aura" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.35" />
                <stop offset="70%" stopColor="#8b5cf6" stopOpacity="0.05" />
                <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
              </radialGradient>
              <linearGradient id="wireActive" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#34d399" stopOpacity="0.15" />
                <stop offset="55%" stopColor="#10b981" stopOpacity="0.95" />
                <stop offset="100%" stopColor="#34d399" stopOpacity="0.15" />
              </linearGradient>
              <filter id="iconGlow" x="-120%" y="-120%" width="340%" height="340%">
                <feGaussianBlur stdDeviation="3.5" />
              </filter>
              <filter id="blurGlow" x="-100%" y="-100%" width="300%" height="300%">
                <feGaussianBlur stdDeviation="12" />
              </filter>
            </defs>

            {/* headers */}
            <text x={150} y={38} textAnchor="middle" className="fill-slate-400 text-[13px] font-bold tracking-[0.18em]">AI CLIENTS</text>
            <text x={500} y={38} textAnchor="middle" className="fill-slate-400 text-[13px] font-bold tracking-[0.18em]">MAILMAN</text>
            <text x={850} y={38} textAnchor="middle" className="fill-slate-400 text-[13px] font-bold tracking-[0.18em]">WHAT IT DOES</text>

            {/* aura */}
            <circle cx={CX} cy={CY} r={150} fill="url(#aura)" />

            {/* wires */}
            {all.map((p, i) => (
              <path
                key={p.id}
                id={p.id}
                d={p.d}
                fill="none"
                strokeWidth={p.active ? 2.2 : 1.4}
                stroke={p.active ? 'url(#wireActive)' : undefined}
                className={p.active ? 'flow-line' : 'stroke-slate-300/55 dark:stroke-slate-700/70 flow-line-slow'}
                style={{ animationDelay: `${(i % 6) * 0.16}s` }}
              />
            ))}

            {/* connection ports on the ring */}
            {all.map((p) => (
              <circle
                key={`port-${p.id}`}
                cx={p.port.x}
                cy={p.port.y}
                r={p.active ? 3.4 : 2.4}
                className={p.active ? 'fill-emerald-400' : 'fill-slate-300 dark:fill-slate-600'}
              />
            ))}

            {/* traveling pulses on active wires */}
            {all.filter((p) => p.active).map((p, i) => (
              <Pulse key={`pulse-${p.id}`} id={p.id} dur={2.8} delay={i * 0.6} />
            ))}

            {/* expanding broadcast rings */}
            <circle cx={CX} cy={CY} r={CORE} className="fill-none stroke-brand-400/50">
              <animate attributeName="r" values={`${CORE};${CORE + 70}`} dur="3.2s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.5;0" dur="3.2s" repeatCount="indefinite" />
            </circle>
            <circle cx={CX} cy={CY} r={CORE} className="fill-none stroke-fuchsia-400/40">
              <animate attributeName="r" values={`${CORE};${CORE + 70}`} dur="3.2s" begin="1.6s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.4;0" dur="3.2s" begin="1.6s" repeatCount="indefinite" />
            </circle>

            {/* hub */}
            <circle cx={CX} cy={CY} r={CORE + 6} fill="url(#hubCore)" opacity="0.55" filter="url(#blurGlow)" />
            <circle cx={CX} cy={CY} r={R} className="fill-none stroke-slate-200 dark:stroke-slate-700" strokeWidth="1" />
            <circle cx={CX} cy={CY} r={R - 8} className="fill-none stroke-brand-400/50" strokeWidth="1.4" strokeDasharray="2 10">
              <animateTransform attributeName="transform" type="rotate" from={`0 ${CX} ${CY}`} to={`360 ${CX} ${CY}`} dur="26s" repeatCount="indefinite" />
            </circle>
            <circle cx={CX} cy={CY} r={CORE} fill="url(#hubCore)" />
            <ellipse cx={CX - 16} cy={CY - 22} rx="24" ry="15" fill="#ffffff" opacity="0.20" />
            <text x={CX} y={CY - 9} textAnchor="middle" className="fill-white/60 text-[10px] font-bold tracking-[0.3em]">MCP</text>
            <text x={CX} y={CY + 15} textAnchor="middle" className="fill-white text-[21px] font-extrabold tracking-tight">MailMan</text>

            {/* labels below hub */}
            <text x={CX} y={CY + R + 26} textAnchor="middle" className="fill-slate-400 text-[13px]" style={{ fontFamily: 'ui-monospace, monospace' }}>/mcp/mailman</text>
            <circle cx={CX - 30} cy={CY + R + 44} r="4" className="fill-emerald-500">
              <animate attributeName="opacity" values="1;0.3;1" dur="2s" repeatCount="indefinite" />
            </circle>
            <text x={CX - 18} y={CY + R + 48} className="fill-emerald-500 text-[13px] font-semibold">ready</text>

            {/* nodes */}
            {CLIENTS.map((c) => (
              <Node key={c.label} x={LX} y={c.y} label={c.label} icon={c.icon} active={c.active} />
            ))}
            {CAPS.map((c) => (
              <Node key={c.label} x={RX} y={c.y} label={c.label} icon={c.icon} active={c.active} />
            ))}
          </svg>
        </div>
      </Reveal>

      <Reveal delay={0.15} className="mt-8 grid gap-4 sm:grid-cols-3">
        {[
          { n: '1', t: 'Ask your AI', d: 'In plain English, in the editor you already use.' },
          { n: '2', t: 'MailMan drafts', d: 'It composes, previews, and waits for your confirm.' },
          { n: '3', t: 'Gmail delivers', d: 'Sent over SMTP/IMAP or the Gmail API — with a ping back.' },
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
