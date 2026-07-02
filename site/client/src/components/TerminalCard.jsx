/*
 * A styled "terminal screenshot". Pass a title and an array of lines:
 *   { role, text }  where role is one of:
 *   'cmd'    → shell command ($ …)
 *   'prompt' → what you say to your AI (you › …)
 *   'out'    → muted tool/preview output
 *   'ok'     → green success line
 *   'warn'   → amber note
 *   'comment'→ dim inline comment
 *
 * Diamond-tree roles (MailMan CLI convention — matches `mailman status`):
 *   'treetop'  → ┌ opening rail
 *   'section'  → ◆ cyan section header
 *   'status'   → ◇ green status line
 *   'rail'     → │   indented detail under a section
 *   'treeend'  → └  green closing label
 */
const ROLE = {
  cmd: 'text-slate-300',
  prompt: 'text-brand-300',
  out: 'text-slate-400',
  ok: 'text-emerald-400',
  warn: 'text-amber-300',
  comment: 'text-slate-500',
};

function Line({ role, text }) {
  if (role === 'prompt') {
    return (
      <div className="whitespace-pre-wrap">
        <span className="text-brand-400">you ›</span> <span className="text-slate-200">{text}</span>
      </div>
    );
  }
  if (role === 'cmd') {
    return (
      <div className="whitespace-pre-wrap">
        <span className="text-emerald-400">$</span> <span className="text-slate-300">{text}</span>
      </div>
    );
  }
  if (role === 'treetop') {
    return <div className="text-slate-600">┌</div>;
  }
  if (role === 'section') {
    return (
      <div className="whitespace-pre-wrap">
        <span className="text-cyan-400">◆</span> <span className="font-semibold text-slate-200">{text}</span>
      </div>
    );
  }
  if (role === 'status') {
    return (
      <div className="whitespace-pre-wrap">
        <span className="text-emerald-400">◇</span> <span className="text-slate-300">{text}</span>
      </div>
    );
  }
  if (role === 'rail') {
    return (
      <div className="whitespace-pre-wrap">
        <span className="text-slate-600">│</span>   <span className="text-slate-400">{text}</span>
      </div>
    );
  }
  if (role === 'treeend') {
    return (
      <div className="whitespace-pre-wrap">
        <span className="text-slate-600">└</span>  <span className="font-semibold text-emerald-400">{text}</span>
      </div>
    );
  }
  return <div className={`whitespace-pre-wrap ${ROLE[role] || 'text-slate-400'}`}>{text}</div>;
}

export default function TerminalCard({ title = 'claude · MailMan', lines = [], className = '' }) {
  return (
    <div
      className={`overflow-hidden rounded-2xl border border-slate-200/60 bg-slate-900 shadow-xl dark:border-slate-800 ${className}`}
    >
      <div className="flex items-center gap-2 border-b border-slate-700/60 px-4 py-3">
        <span className="h-3 w-3 rounded-full bg-red-400" />
        <span className="h-3 w-3 rounded-full bg-yellow-400" />
        <span className="h-3 w-3 rounded-full bg-green-400" />
        <span className="ml-2 truncate font-mono text-xs text-slate-400">{title}</span>
      </div>
      <pre className="overflow-x-auto p-5 font-mono text-[13px] leading-relaxed">
        <code className="block space-y-1">
          {lines.map((l, i) => (
            <Line key={i} {...l} />
          ))}
        </code>
      </pre>
    </div>
  );
}
