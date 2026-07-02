/*
 * Inline SVG icon set. One consistent system:
 *  - 24×24 viewBox, stroke-based (Lucide-style), 1.75 stroke width
 *  - stroke="currentColor" so icons inherit text color + adapt to dark/light
 *  - every icon takes a className for sizing (e.g. "h-6 w-6")
 * Brand/product marks (AI tools, OS) are drawn as tasteful geometric marks
 * rather than trademarked logos.
 */

const S = ({ className = 'h-6 w-6', children, fill = 'none', ...rest }) => (
  <svg
    viewBox="0 0 24 24"
    fill={fill}
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    {...rest}
  >
    {children}
  </svg>
);

/* ---- feature / UI icons -------------------------------------------- */
export const Mail = (p) => (
  <S {...p}>
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
  </S>
);

export const MessageSquare = (p) => (
  <S {...p}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    <path d="M8 9h8M8 13h5" />
  </S>
);

export const ShieldCheck = (p) => (
  <S {...p}>
    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
    <path d="m9 12 2 2 4-4" />
  </S>
);

export const Paperclip = (p) => (
  <S {...p}>
    <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </S>
);

export const Clock = (p) => (
  <S {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </S>
);

export const Inbox = (p) => (
  <S {...p}>
    <path d="M22 12h-6l-2 3h-4l-2-3H2" />
    <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  </S>
);

export const Users = (p) => (
  <S {...p}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
  </S>
);

export const Bell = (p) => (
  <S {...p}>
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </S>
);

export const Lock = (p) => (
  <S {...p}>
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </S>
);

export const Laptop = (p) => (
  <S {...p}>
    <path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9" />
    <path d="M2 16h20l-1.28 2.55a1 1 0 0 1-.9.45H4.18a1 1 0 0 1-.9-.45L2 16z" />
  </S>
);

export const Bot = (p) => (
  <S {...p}>
    <path d="M12 8V4M12 4h-1.5M12 4h1.5" />
    <rect x="4" y="8" width="16" height="12" rx="2" />
    <path d="M2 14h2M20 14h2M9 13v2M15 13v2" />
  </S>
);

export const Terminal = (p) => (
  <S {...p}>
    <path d="m4 17 6-6-6-6" />
    <path d="M12 19h8" />
  </S>
);

export const Plus = (p) => (
  <S {...p}>
    <path d="M12 5v14M5 12h14" />
  </S>
);

export const Sun = (p) => (
  <S {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
  </S>
);

export const Moon = (p) => (
  <S {...p}>
    <path d="M12 3a6.5 6.5 0 0 0 9 9 9 9 0 1 1-9-9z" />
  </S>
);

export const Package = (p) => (
  <S {...p}>
    <path d="m7.5 4.27 9 5.15" />
    <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <path d="m3.3 7 8.7 5 8.7-5M12 22V12" />
  </S>
);

export const ExternalLink = (p) => (
  <S {...p}>
    <path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
  </S>
);

/* ---- OS marks ------------------------------------------------------- */
export const Apple = ({ className = 'h-8 w-8' }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d="M16.36 12.65c-.02-2.06 1.68-3.05 1.76-3.1-0.96-1.4-2.45-1.6-2.98-1.62-1.27-.13-2.48.75-3.12.75-.64 0-1.64-.73-2.7-.71-1.39.02-2.67.81-3.38 2.05-1.44 2.5-.37 6.19 1.03 8.22.69.99 1.5 2.1 2.57 2.06 1.03-.04 1.42-.67 2.67-.67 1.24 0 1.6.67 2.69.65 1.11-.02 1.81-1.01 2.49-2.01.78-1.15 1.1-2.26 1.12-2.32-.02-.01-2.15-.83-2.17-3.27z" />
    <path d="M14.5 6.6c.57-.69.95-1.65.85-2.6-.82.03-1.81.55-2.4 1.24-.53.61-.99 1.58-.87 2.51.91.07 1.85-.47 2.42-1.15z" />
  </svg>
);

export const Windows = ({ className = 'h-8 w-8' }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d="M3 5.5 10.5 4.4V11H3zM10.5 12v6.6L3 17.5V12zM11.6 4.2 21 3v8h-9.4zM21 12v9l-9.4-1.3V12z" />
  </svg>
);

export const Linux = ({ className = 'h-8 w-8' }) => (
  // Simplified penguin mark, geometric.
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d="M12 2c-1.9 0-3.3 1.6-3.3 3.7 0 .9.1 1.9.1 2.8 0 1.1-1 2-1.7 3.2-.8 1.2-1.8 2.6-1.8 4.5 0 .7.3 1.2.8 1.5-.2.5-.3 1-.3 1.4 0 1.1 1.6 1.4 3.6 1.4h5.2c2 0 3.6-.3 3.6-1.4 0-.4-.1-.9-.3-1.4.5-.3.8-.8.8-1.5 0-1.9-1-3.3-1.8-4.5-.7-1.2-1.7-2.1-1.7-3.2 0-.9.1-1.9.1-2.8C15.3 3.6 13.9 2 12 2z" />
    <circle cx="10.4" cy="6.4" r="1" fill="#fff" />
    <circle cx="13.6" cy="6.4" r="1" fill="#fff" />
    <path d="M11 8.2c.3.4.7.6 1 .6s.7-.2 1-.6l-1-.7z" fill="#f5a623" />
  </svg>
);

/* ---- AI-tool geometric marks --------------------------------------- */
export const Sparkle = ({ className = 'h-5 w-5' }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d="M12 2c.5 4.5 1.9 6.5 6 7-4.1.5-5.5 2.5-6 7-.5-4.5-1.9-6.5-6-7 4.1-.5 5.5-2.5 6-7z" />
  </svg>
);

export const Cursor = ({ className = 'h-5 w-5' }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d="M5 3l14 8-6 1.5L10 20 5 3z" />
  </svg>
);

export const Wave = ({ className = 'h-5 w-5' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={className} aria-hidden="true">
    <path d="M2 9c2 0 2 3 4 3s2-3 4-3 2 3 4 3 2-3 4-3 2 3 4 3" />
    <path d="M2 15c2 0 2 3 4 3s2-3 4-3 2 3 4 3 2-3 4-3 2 3 4 3" />
  </svg>
);

export const Code = ({ className = 'h-5 w-5' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <path d="m8 6-6 6 6 6M16 6l6 6-6 6" />
  </svg>
);
