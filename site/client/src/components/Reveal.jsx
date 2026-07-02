// Fade + rise entrance — CSS only (no JS/observer), so content is guaranteed to
// end visible. The .reveal keyframe animates opacity/transform on mount; if
// animations are disabled (reduced motion) the element simply shows at its
// natural opacity. delay staggers siblings.
export default function Reveal({ children, delay = 0, className = '' }) {
  return (
    <div className={`reveal ${className}`} style={{ animationDelay: `${delay}s` }}>
      {children}
    </div>
  );
}
