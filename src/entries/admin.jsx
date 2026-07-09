import React from 'react';
import { createRoot } from 'react-dom/client';
import Admin from '../pages/Admin.jsx';

// No <StrictMode>: the page hosts nine classic (non-React) admin-*.js
// modules that own the DOM after mount — double-invoking effects would
// double-inject them. adminShell.boot() also guards against re-entry.
createRoot(document.getElementById('root')).render(<Admin />);
