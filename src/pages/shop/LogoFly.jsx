import React from 'react';
import { css } from './css.js';

// LOGO FLY SYSTEM — markup 1:1 from public/index.html.
export default function LogoFly() {
  return (
    <>
      <div className="logo-backdrop" id="logoBackdrop" onClick={() => window.logoFlyBack()}></div>
      <div className="logo-fly-wrap" id="logoFlyWrap" style={css('display:none;')}><img src="https://cdn.store-assets.com/s/1408881/f/16655641.png" alt="MJM Nursery" /></div>
      <div className="logo-slogan-float" id="logoSlogan">The Golden Standard of Oil Palm Seedling</div>
    </>
  );
}
