// Canonical site content, seeded into the site_content table (key → JSON).
// Icons are stored as string keys the frontend maps to components (see
// client icons registry). Everything here is editable straight in the DB
// later without a schema change.

export const SEED = {
  features: [
    { icon: 'messageSquare', title: 'Natural-language send', desc: 'Ask in plain English. MailMan composes the subject and body and shows you a preview first.' },
    { icon: 'sparkle', title: '182 message templates', desc: 'FYI, follow-up, meeting, status, forward/reply and 175+ more — each a subject prefix + a hint your AI composes from. Browse with list_templates.' },
    { icon: 'shieldCheck', title: 'Draft → preview → confirm', desc: 'Nothing leaves your machine until you approve it. confirm_send won’t dispatch without an explicit confirmation — and it’s idempotent.' },
    { icon: 'paperclip', title: 'Attachments & globs', desc: 'Attach files, whole folders, or wildcard patterns like *.pdf — with a 25 MB size guard and a preview of what attaches.' },
    { icon: 'clock', title: 'Scheduled sends', desc: '“Send tomorrow at 9am.” An OS-level timer fires it even if your AI tool is closed.' },
    { icon: 'inbox', title: 'Read & search inbox', desc: 'List recent mail, read full messages, and search by sender, subject, date or has:attachment.' },
    { icon: 'users', title: 'Contacts & suggestions', desc: 'Everyone you email is remembered. Say “email John” and get ranked, fuzzy-matched suggestions.' },
    { icon: 'bell', title: 'Desktop notifications', desc: 'A native “email sent” notification after every send — interactive and scheduled. On by default.' },
    { icon: 'lock', title: 'Machine-bound security', desc: 'AES-256-GCM over your credentials, master key in the OS keychain. Copy-proof across machines.' },
    { icon: 'laptop', title: 'Cross-OS, pure Node', desc: 'Same behavior on macOS, Linux and Windows. Ships as @indianic/mailman on the private registry.' },
  ],

  aiTools: [
    { name: 'Claude', icon: 'sparkle', color: 'text-orange-500' },
    { name: 'Gemini', icon: 'sparkle', color: 'text-blue-500' },
    { name: 'OpenAI', icon: 'openai', color: 'text-emerald-600 dark:text-emerald-400' },
    { name: 'Cursor', icon: 'cursor', color: 'text-slate-700 dark:text-slate-200' },
    { name: 'Windsurf', icon: 'wave', color: 'text-teal-500' },
    { name: 'Codex', icon: 'code', color: 'text-violet-500' },
  ],

  platforms: [
    { name: 'macOS', icon: 'apple', note: 'Verified end-to-end', color: 'text-slate-800 dark:text-slate-100' },
    { name: 'Linux', icon: 'linux', note: 'Verified (Docker)', color: 'text-slate-800 dark:text-slate-100' },
    { name: 'Windows', icon: 'windows', note: 'Supported, pure Node', color: 'text-sky-500' },
  ],

  faqs: [
    { q: 'Do I need to be technical to use it?', a: 'No. A developer (or the setup wizard) installs it once. After that you just talk to your AI assistant in plain English — “email this to Kalpesh Gamit,” “what did I get from finance today?”' },
    { q: 'Is my email account safe?', a: 'Yes. Your credentials are encrypted with AES-256-GCM and the key lives in your operating system’s keychain — never in a plain file and never uploaded to us. Copying the config to another machine yields useless ciphertext.' },
    { q: 'Will it send an email without my permission?', a: 'Never. Every send follows draft → preview → confirm. MailMan prepares the message, shows you exactly what will go out, and only sends after you say “yes.”' },
    { q: 'Which email providers work?', a: 'Gmail today — via a simple App Password (recommended) or OAuth2 for Workspace setups. Sending uses SMTP; reading and search use IMAP or the Gmail API.' },
    { q: 'What happens if I close my AI tool?', a: 'Scheduled emails still go out. The first time you schedule something, MailMan installs an OS-level timer (launchd, cron, or Task Scheduler) that fires independently of your editor.' },
    { q: 'How do I get it / how is it distributed?', a: 'It ships as @indianic/mailman on the IndiaNIC private npm registry. Install globally, run mailman init, then mailman register to wire it into your AI editor.' },
  ],

  howTo: [
    { icon: 'messageSquare', title: 'Send', examples: ['“Email the Q3 report to kalpesh.gamit@indianic.com.”', '“Reply to the last email from finance and say I approve.”', '“Send a thank-you note to everyone on yesterday’s call.”'] },
    { icon: 'inbox', title: 'Read & search', examples: ['“Show my last 10 emails.”', '“Any unread mail from Priya this week?”', '“Find the invoice with an attachment from March.”'] },
    { icon: 'clock', title: 'Schedule', examples: ['“Send this tomorrow at 9am.”', '“Schedule the newsletter for Monday morning.”', '“What sends do I have queued?”'] },
    { icon: 'paperclip', title: 'Attach', examples: ['“Attach all the PDFs in ~/reports and send to the team.”', '“Send the deck folder to Kalpesh Gamit.”', '“What would *.png in this folder attach?”'] },
  ],

  examples: [
    { title: 'claude · ship a PR for review', lines: [
      { role: 'prompt', text: 'email the PR link to Kalpesh Gamit for review' },
      { role: 'treetop' }, { role: 'section', text: 'draft — preview' },
      { role: 'rail', text: 'to · kalpesh.gamit@indianic.com' },
      { role: 'rail', text: 'subject · Auth refactor ready for review' },
      { role: 'status', text: 'previewed · awaiting confirm' },
      { role: 'treeend', text: 'sent · notification shown' },
    ] },
    { title: 'cursor · send a build artifact', lines: [
      { role: 'prompt', text: 'attach ./dist/report.html and send to kalpesh.gamit@indianic.com' },
      { role: 'treetop' }, { role: 'section', text: 'attachment' },
      { role: 'rail', text: 'report.html · 84 KB (under 25 MB)' },
      { role: 'section', text: 'draft' },
      { role: 'rail', text: 'to · kalpesh.gamit@indianic.com' },
      { role: 'rail', text: 'subject · QA build — please verify' },
      { role: 'treeend', text: 'sent' },
    ] },
    { title: 'gemini · triage without switching tabs', lines: [
      { role: 'prompt', text: 'any unread from the Acme client this week?' },
      { role: 'treetop' }, { role: 'section', text: 'inbox — Acme Corp' },
      { role: 'rail', text: 'Re: staging credentials' },
      { role: 'rail', text: 'Invoice #4412' },
      { role: 'rail', text: 'Launch date confirmation?' },
      { role: 'status', text: '3 unread' },
      { role: 'treeend', text: 'reply sent · confirmed for Aug 12' },
    ] },
    { title: 'claude · schedule the EOD summary', lines: [
      { role: 'prompt', text: 'schedule an EOD update to the team tomorrow at 9am' },
      { role: 'treetop' }, { role: 'section', text: 'schedule' },
      { role: 'rail', text: 'when · Jul 3, 09:00 (Asia/Kolkata)' },
      { role: 'rail', text: 'fires via an OS timer even if the editor is closed' },
      { role: 'status', text: 'queued · id sch_20e8…' },
      { role: 'treeend', text: 'ready' },
    ] },
    { title: 'zsh · mailman status', lines: [
      { role: 'cmd', text: 'mailman status' },
      { role: 'treetop' }, { role: 'section', text: 'accounts' },
      { role: 'rail', text: 'default · kalpesh.gamit@indianic.com (App Password)' },
      { role: 'rail', text: 'personal · you@gmail.com (App Password)' },
      { role: 'section', text: 'security' },
      { role: 'status', text: 'keychain reachable · AES-256-GCM' },
      { role: 'section', text: 'scheduler' },
      { role: 'status', text: 'launchd ticker installed' },
      { role: 'section', text: 'notifications' },
      { role: 'rail', text: 'desktop: on' },
      { role: 'treeend', text: 'ready' },
    ] },
    { title: 'windsurf · loop a teammate on an error', lines: [
      { role: 'prompt', text: 'forward this stack trace to Kalpesh Gamit and ask if he’s seen it' },
      { role: 'treetop' }, { role: 'section', text: 'draft' },
      { role: 'rail', text: 'to · kalpesh.gamit@indianic.com' },
      { role: 'rail', text: 'subject · Seen this before?' },
      { role: 'rail', text: 'the trace is quoted inline' },
      { role: 'treeend', text: 'sent · back to your code' },
    ] },
  ],

  constellation: [
    { top: '8%', left: '50%', size: 70, grad: 'from-blue-400 to-blue-600', icon: 'mail', label: 'Send email', dur: 6, delay: 0 },
    { top: '24%', left: '20%', size: 62, grad: 'from-amber-400 to-orange-500', icon: 'sparkle', label: 'Claude', dur: 7, delay: 0.6 },
    { top: '20%', left: '80%', size: 58, grad: 'from-sky-400 to-blue-600', icon: 'sparkle', label: 'Gemini', dur: 6.5, delay: 1.1 },
    { top: '50%', left: '11%', size: 56, grad: 'from-slate-600 to-slate-800', icon: 'cursor', label: 'Cursor', dur: 8, delay: 0.3 },
    { top: '48%', left: '89%', size: 60, grad: 'from-emerald-400 to-teal-600', icon: 'openai', label: 'OpenAI', dur: 7.5, delay: 0.9 },
    { top: '80%', left: '24%', size: 58, grad: 'from-violet-500 to-purple-700', icon: 'paperclip', label: 'Attachments', dur: 6.8, delay: 1.4 },
    { top: '82%', left: '76%', size: 60, grad: 'from-rose-400 to-pink-600', icon: 'clock', label: 'Schedule', dur: 7.2, delay: 0.4 },
    { top: '90%', left: '50%', size: 56, grad: 'from-indigo-400 to-indigo-600', icon: 'inbox', label: 'Read inbox', dur: 6.2, delay: 1.7 },
  ],
};
