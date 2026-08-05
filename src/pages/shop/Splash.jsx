import React from 'react';

// SPLASH POSTER — editorial 2-column layout. Countdown, rays,
// particles and dismissal are driven by initSplash() (splash.js).
export default function Splash() {
  return (
    <div id="splash-poster">
      <div className="splash-countdown"><span className="splash-countdown-num" id="splash-cd">3</span></div>
      <div className="splash-shimmer"></div>
      <div className="splash-rays" id="splash-rays"></div>
      <div id="splash-particles"></div>

      <div className="splash-inner">
        {/* LEFT — editorial headline + tagline */}
        <div className="splash-hero-left">
          <h1 className="splash-heading">
            Oil Palm <span className="splash-heading-em">Seedling</span>
          </h1>
          <div className="splash-hero-rule" aria-hidden="true"></div>
          <div className="splash-tagline">Top Quality. High Yield. Stronger Future.</div>
        </div>

        {/* RIGHT — award badge, halo, seedling, feature cards */}
        <div className="splash-hero-right">
          <div className="splash-award-wrap" role="img" aria-label="Best Nursery Award">
            <svg className="splash-award-laurel" viewBox="0 0 40 60" aria-hidden="true">
              <path d="M36 4 C 20 18, 10 36, 4 58" stroke="#E8D49A" strokeWidth="1.4" fill="none" strokeLinecap="round"/>
              <ellipse cx="30" cy="10" rx="2.8" ry="5.6" fill="#E8D49A" transform="rotate(-35 30 10)"/>
              <ellipse cx="24" cy="20" rx="2.8" ry="5.6" fill="#E8D49A" transform="rotate(-25 24 20)"/>
              <ellipse cx="17" cy="30" rx="2.8" ry="5.6" fill="#E8D49A" transform="rotate(-15 17 30)"/>
              <ellipse cx="12" cy="41" rx="2.8" ry="5.6" fill="#E8D49A" transform="rotate(-5 12 41)"/>
              <ellipse cx="7"  cy="52" rx="2.8" ry="5.6" fill="#E8D49A" transform="rotate(8 7 52)"/>
            </svg>
            <div className="splash-award">
              <span className="splash-award-ico" aria-hidden="true">&#127942;</span>
              <span className="splash-award-text">Best Nursery Award</span>
            </div>
            <svg className="splash-award-laurel splash-award-laurel-r" viewBox="0 0 40 60" aria-hidden="true">
              <path d="M36 4 C 20 18, 10 36, 4 58" stroke="#E8D49A" strokeWidth="1.4" fill="none" strokeLinecap="round"/>
              <ellipse cx="30" cy="10" rx="2.8" ry="5.6" fill="#E8D49A" transform="rotate(-35 30 10)"/>
              <ellipse cx="24" cy="20" rx="2.8" ry="5.6" fill="#E8D49A" transform="rotate(-25 24 20)"/>
              <ellipse cx="17" cy="30" rx="2.8" ry="5.6" fill="#E8D49A" transform="rotate(-15 17 30)"/>
              <ellipse cx="12" cy="41" rx="2.8" ry="5.6" fill="#E8D49A" transform="rotate(-5 12 41)"/>
              <ellipse cx="7"  cy="52" rx="2.8" ry="5.6" fill="#E8D49A" transform="rotate(8 7 52)"/>
            </svg>
          </div>

          <div className="splash-center">
            <div className="splash-feature">
              <div className="splash-feature-icon">&#11088;&#11088;&#11088;&#11088;&#11088;</div>
              <div className="splash-feature-text">Top<br />Quality</div>
            </div>

            <div className="splash-plant">
              <div className="splash-halo" aria-hidden="true"></div>
              <div className="splash-glow"></div>
              <img src="https://cdn.store-assets.com/s/1408881/f/16655809.png" alt="Oil Palm Seedling" className="splash-seedling" />
            </div>

            <div className="splash-feature">
              <div className="splash-feature-icon">&#128200;</div>
              <div className="splash-feature-text">High Yield<br />Fruit</div>
            </div>
          </div>

          <div className="splash-caption">Oil Palm Seedling</div>
        </div>
      </div>
    </div>
  );
}
