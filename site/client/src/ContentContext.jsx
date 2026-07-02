import { createContext, useContext, useEffect, useState } from 'react';

// Fetches editable site content from /api/content once and provides it.
// Components read a section via useContent(key, fallback) — the fallback keeps
// the UI intact if the API is unreachable.
const ContentContext = createContext({});

export function ContentProvider({ children }) {
  const [content, setContent] = useState({});

  useEffect(() => {
    let active = true;
    fetch('/api/content')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (active && data && !data.error) setContent(data);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  return <ContentContext.Provider value={content}>{children}</ContentContext.Provider>;
}

export function useContent(key, fallback) {
  const content = useContext(ContentContext);
  const value = content?.[key];
  return Array.isArray(value) && value.length ? value : fallback;
}
