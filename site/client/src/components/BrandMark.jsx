// MailMan brand mark — an open envelope with an "AI" card, built on a
// golden-ratio grid (φ ≈ 1.618) for balanced proportions:
//   • canvas 100×100, iOS-style squircle radius 22.5 (≈ 100 · (φ−1)/φ)
//   • envelope is a GOLDEN RECTANGLE — W 64 : H 40 ≈ φ:1
//   • AI card width 24 ≈ envelope W ÷ φ² (64 / 2.618); card is a golden
//     rectangle too (24 × 39 ≈ 1 : φ)
//   • composition optically centered: card top (18) → envelope base (82),
//     midpoint = 50
// Self-contained (own gradient tile) so it reads on light AND dark pages.
// public/favicon.svg mirrors this artwork exactly.
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
      {/* AI card (golden rect 24×39), centered, peeking above the envelope */}
      <rect x="38" y="18" width="24" height="39" rx="5" fill="#ffffff" />
      <text
        x="50"
        y="35"
        textAnchor="middle"
        fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif"
        fontWeight="800"
        fontSize="16"
        fill="url(#mm-ai)"
      >
        AI
      </text>
      {/* envelope front — golden rectangle footprint (W64 : H40 ≈ φ) */}
      <path
        d="M18 42 L50 60 L82 42 L82 77 a5 5 0 0 1 -5 5 L23 82 a5 5 0 0 1 -5 -5 Z"
        fill="#ffffff"
      />
      {/* open-flap fold line */}
      <path
        d="M18 42 L50 60 L82 42"
        fill="none"
        stroke="#c7d2fe"
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
