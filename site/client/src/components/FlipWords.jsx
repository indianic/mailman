import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// Rotating headline word: flips through `words` on an interval with a
// vertical flip + fade. Width follows the widest word so layout doesn't jump.
export default function FlipWords({
  words,
  interval = 2200,
  className = '',
  colorClass = 'text-gradient',
}) {
  const [i, setI] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setI((n) => (n + 1) % words.length), interval);
    return () => clearInterval(id);
  }, [words.length, interval]);

  return (
    <span className={`relative inline-grid ${className}`} style={{ verticalAlign: 'bottom' }}>
      {/* invisible sizer keeps the box as wide/tall as the longest word */}
      <span className="invisible col-start-1 row-start-1" aria-hidden="true">
        {words.reduce((a, b) => (b.length > a.length ? b : a), '')}
      </span>
      <AnimatePresence mode="wait">
        <motion.span
          key={words[i]}
          initial={{ y: '60%', opacity: 0, rotateX: -80 }}
          animate={{ y: '0%', opacity: 1, rotateX: 0 }}
          exit={{ y: '-60%', opacity: 0, rotateX: 80 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className={`${colorClass} col-start-1 row-start-1 inline-block`}
          style={{ transformOrigin: 'bottom' }}
        >
          {words[i]}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
