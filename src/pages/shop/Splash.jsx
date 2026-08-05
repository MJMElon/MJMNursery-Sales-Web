import React from 'react';

// SPLASH POSTER — markup 1:1 from public/index.html. Countdown, rays,
// particles and dismissal are driven by initSplash() (splash.js).
export default function Splash() {
  return (
    <div id="splash-poster">
      <div className="splash-countdown"><span className="splash-countdown-num" id="splash-cd">3</span></div>
      <div className="splash-shimmer"></div>
      <div className="splash-rays" id="splash-rays"></div>
      <div id="splash-particles"></div>

      <div className="splash-inner">
        <img src="https://cdn.store-assets.com/s/1408881/f/16655641.png" alt="MJM Nursery" className="splash-logo" />
        <div className="splash-award">&#127942; Best Nursery Award</div>

        <div className="splash-center">
          {/* Left features */}
          <div className="splash-feature">
            <div className="splash-feature-icon">&#11088;&#11088;&#11088;&#11088;&#11088;</div>
            <div className="splash-feature-text">Top<br />Quality</div>
          </div>

          {/* Center seedling */}
          <div className="splash-plant">
            <div className="splash-glow"></div>
            <img src="https://cdn.store-assets.com/s/1408881/f/16655809.png" alt="Oil Palm Seedling" className="splash-seedling" />
          </div>

          {/* Right features */}
          <div className="splash-feature">
            <div className="splash-feature-icon">&#128200;</div>
            <div className="splash-feature-text">High Yield<br />Fruit</div>
          </div>
        </div>

        <h1 className="splash-title">Oil Palm Seedling</h1>
      </div>
    </div>
  );
}
