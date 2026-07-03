import { createContext, useContext, useEffect, useState } from 'react';

const ThemeContext = createContext(null);

function getInitial() {
  if (typeof window === 'undefined') return 'light';
  // Light is the default for everyone; only an explicit user choice of 'dark'
  // overrides it (OS preference is intentionally ignored).
  return localStorage.getItem('theme') === 'dark' ? 'dark' : 'light';
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(getInitial);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggle = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
