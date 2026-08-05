// Splash poster countdown/dismiss.
//
// Timings: 3-second countdown, then fade out. The CSS auto-fade
// safety net used to run at 4s (different clock, race prone); it
// now mirrors this JS at 3.2s so a JS-blocked page still dismisses
// with the same feel.
//
// Motion: if the user has prefers-reduced-motion set, we skip
// spawning the 12 rays + 20 particles entirely and let the CSS
// media query flatten the remaining decorative animations.
export function initSplash() {
  function dismissSplash() {
    var s = document.getElementById('splash-poster');
    if (!s) return;
    s.classList.add('fade-out');
    setTimeout(function() { if (s && s.parentNode) s.parentNode.removeChild(s); }, 800);
  }

  try {
    if (sessionStorage.getItem('mjm_splash_shown') || sessionStorage.getItem('mjm_last_page')) {
      var s = document.getElementById('splash-poster');
      if (s && s.parentNode) s.parentNode.removeChild(s);
      return;
    }
    sessionStorage.setItem('mjm_splash_shown', '1');
  } catch (_) {}

  var reduceMotion = false;
  try {
    reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (_) {}

  // Rays + particles are pure decoration — skip both when the user
  // asked for reduced motion. Sizes match the legacy build so the
  // static (non-animated) layout still looks the same.
  if (!reduceMotion) {
    try {
      var raysEl = document.getElementById('splash-rays');
      if (raysEl) {
        for (var i = 0; i < 12; i++) {
          var ray = document.createElement('div');
          ray.className = 'splash-ray';
          ray.style.transform = 'rotate(' + (i * 30) + 'deg)';
          ray.style.opacity = (0.3 + Math.random() * 0.5).toFixed(2);
          ray.style.animation = 'raysPulse ' + (2 + Math.random() * 2).toFixed(1) + 's ease-in-out infinite';
          ray.style.animationDelay = (Math.random() * 2).toFixed(1) + 's';
          raysEl.appendChild(ray);
        }
      }
      var partEl = document.getElementById('splash-particles');
      if (partEl) {
        for (var j = 0; j < 20; j++) {
          var p = document.createElement('div');
          p.className = 'splash-particle';
          p.style.left = (10 + Math.random() * 80) + '%';
          p.style.top = (40 + Math.random() * 50) + '%';
          p.style.width = (2 + Math.random() * 4) + 'px';
          p.style.height = p.style.width;
          p.style.animationDuration = (3 + Math.random() * 4) + 's';
          p.style.animationDelay = (Math.random() * 4) + 's';
          partEl.appendChild(p);
        }
      }
    } catch (_) {}
  }

  var cdEl = document.getElementById('splash-cd');
  var cdNum = 3;
  var cdInterval = setInterval(function() {
    cdNum--;
    if (cdEl) cdEl.textContent = cdNum;
    if (cdNum <= 0) clearInterval(cdInterval);
  }, 1000);

  setTimeout(dismissSplash, 3000);

  // Explicit skip button + click-through both dismiss. Keyboard
  // access via ESC too — some visitors reach for it before the
  // mouse when a full-screen overlay steals focus.
  var splashEl = document.getElementById('splash-poster');
  var skipEl = document.getElementById('splash-skip');
  if (skipEl) skipEl.addEventListener('click', function(e){ e.stopPropagation(); dismissSplash(); });
  if (splashEl) splashEl.addEventListener('click', dismissSplash);
  var onKey = function(e){ if (e.key === 'Escape') dismissSplash(); };
  document.addEventListener('keydown', onKey, { once: true });
}
