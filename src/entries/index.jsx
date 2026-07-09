import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import Shop from '../pages/shop/Shop.jsx';
import { initSplash } from '../pages/shop/splash.js';
import { initShopMain } from '../pages/shop/main.js';

// Storefront entry. The legacy page was one big HTML document whose inline
// scripts executed top-to-bottom AFTER the markup they touched had parsed:
//   splash markup → splash script → rest of markup → main script.
// Replicate that exactly: commit the full React tree synchronously
// (flushSync), then run the splash script, then the main storefront script.
const root = createRoot(document.getElementById('root'));
flushSync(() => root.render(<Shop />));
initSplash();
initShopMain();
