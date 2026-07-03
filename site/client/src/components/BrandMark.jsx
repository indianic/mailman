// MailMan brand mark — a big, legible "AI" card rising out of an envelope, on
// the site's indigo→fuchsia gradient. The AI card is the hero (large + bold) so
// "AI" stays readable down to favicon size; the envelope is a smaller accent.
// iOS-style squircle radius (22.5). Self-contained (own tile) → works on light
// AND dark. public/favicon.svg mirrors this artwork exactly.
export default function BrandMark({ className = 'h-8 w-8' }) {
  return (
    <svg viewBox="0 0 100 100" className={className} role="img" aria-label="MailMan">
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
      <rect width="100" height="100" rx="22.5" fill="url(#mm-bg)" />
      {/* AI card — the hero: large, so "AI" reads at any size */}
      <rect x="27" y="12" width="46" height="46" rx="9" fill="#ffffff" />
      <text
        x="50"
        y="44"
        textAnchor="middle"
        fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif"
        fontWeight="800"
        fontSize="28"
        letterSpacing="0.5"
        fill="url(#mm-ai)"
      >
        AI
      </text>
      {/* envelope front — a smaller accent that cradles the card's base */}
      <path
        d="M12 54 L50 70 L88 54 L88 82 a5 5 0 0 1 -5 5 L17 87 a5 5 0 0 1 -5 -5 Z"
        fill="#ffffff"
      />
      <path
        d="M12 54 L50 70 L88 54"
        fill="none"
        stroke="#c7d2fe"
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
