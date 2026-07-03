// MailMan brand mark — an open envelope with an "AI" card peeking out, on the
// site's indigo→fuchsia gradient. Self-contained (its own tile background), so
// it reads on both light and dark pages. Used in the navbar, footer, and as the
// favicon (see public/favicon.svg, which mirrors this artwork).
export default function BrandMark({ className = 'h-8 w-8', rounded = 14 }) {
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label="MailMan">
      <defs>
        <linearGradient id="mm-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="1" stopColor="#d946ef" />
        </linearGradient>
        <linearGradient id="mm-ai" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4f46e5" />
          <stop offset="1" stopColor="#a21caf" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx={rounded} fill="url(#mm-bg)" />
      {/* AI card peeking out of the envelope */}
      <rect x="20" y="9" width="24" height="24" rx="4" fill="#ffffff" />
      <text
        x="32"
        y="26"
        textAnchor="middle"
        fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif"
        fontWeight="800"
        fontSize="14"
        fill="url(#mm-ai)"
      >
        AI
      </text>
      {/* envelope front, covering the base of the card */}
      <path
        d="M12 30 L32 44 L52 30 L52 50 a4 4 0 0 1 -4 4 L16 54 a4 4 0 0 1 -4 -4 Z"
        fill="#ffffff"
      />
      {/* the open-flap fold line */}
      <path
        d="M12 30 L32 44 L52 30"
        fill="none"
        stroke="#c7d2fe"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
