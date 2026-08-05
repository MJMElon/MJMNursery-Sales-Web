import React from 'react';

// SPLASH POSTER — a short branded intro shown once per session.
// Accessibility upgrades vs. the legacy markup:
//   * role=dialog + aria-label so screen readers announce the poster
//     as a temporary overlay, not "unlabelled region".
//   * aria-hidden on every decorative div (rays / particles / shimmer
//     / glow) so nothing screams "empty landmark".
//   * aria-live=polite on the countdown line — the number swap now
//     carries context ("Entering in 3…"), not a lone digit.
//   * A visible Skip button (top-right) instead of "click anywhere"
//     as the only escape hatch.
// Motion + reduced-motion handling is in shop.css.
export default function Splash() {
  return (
    <div id="splash-poster" role="dialog" aria-label="MJM Nursery — welcome screen" aria-modal="true">
      <div className="splash-countdown" aria-live="polite">
        Entering shop in <span className="splash-countdown-num" id="splash-cd">3</span>
      </div>
      <button
        type="button"
        id="splash-skip"
        className="splash-skip"
        aria-label="Skip welcome screen and enter shop now"
      >Skip →</button>

      <div className="splash-shimmer"   aria-hidden="true"></div>
      <div className="splash-rays"      aria-hidden="true" id="splash-rays"></div>
      <div id="splash-particles"        aria-hidden="true"></div>

      <div className="splash-inner">
        <img
          src="https://cdn.store-assets.com/s/1408881/f/16655641.png"
          alt="MJM Nursery"
          className="splash-logo"
        />
        <div className="splash-award">&#127942; Best Nursery Award</div>

        <div className="splash-center">
          {/* Left features */}
          <div className="splash-feature">
            <div className="splash-feature-icon" aria-hidden="true">&#11088;&#11088;&#11088;&#11088;&#11088;</div>
            <div className="splash-feature-text">Top<br />Quality</div>
          </div>

          {/* Center seedling */}
          <div className="splash-plant">
            <div className="splash-glow" aria-hidden="true"></div>
            <img
              src="https://cdn.store-assets.com/s/1408881/f/16655809.png"
              alt="Oil Palm Seedling"
              className="splash-seedling"
            />
          </div>

          {/* Right features */}
          <div className="splash-feature">
            <div className="splash-feature-icon" aria-hidden="true">&#128200;</div>
            <div className="splash-feature-text">High Yield<br />Fruit</div>
          </div>
        </div>

        <h1 className="splash-title">Oil Palm Seedling</h1>
      </div>
    </div>
  );
}
