import React from 'react';
import { createRoot } from 'react-dom/client';

// Placeholder entry so Vite has at least one page to build while every
// real page still lives in public/. Not linked from anywhere; remove it
// once the first real page (auth.html) becomes a React entry.
function Dev() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
      <h1>MJM Sales Web — React build pipeline OK</h1>
      <p>This page is a build placeholder and is not linked from the site.</p>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<Dev />);
