// Splash poster countdown/dismiss — ported verbatim from the inline
// <script> that followed the splash markup in public/index.html.
// Ran as an IIFE right after the splash HTML parsed; here it runs as
// initSplash() immediately after the React tree is committed, before
// the main storefront script — same relative order, same behaviour.
export function initSplash() {
  // showNav() used to flip navbar.style.display from 'none' → ''; the navbar
  // no longer starts hidden so this is a no-op kept for compatibility with
  // any old cached scripts that might still call it.
  function showNav() {}
  function dismissSplash() {
    var s = document.getElementById('splash-poster');
    showNav();
    if (s) {
      s.classList.add('fade-out');
      setTimeout(function() { if (s && s.parentNode) s.parentNode.removeChild(s); }, 1200);
    }
  }

  try {
    if (sessionStorage.getItem('mjm_splash_shown') || sessionStorage.getItem('mjm_last_page')) {
      var s = document.getElementById('splash-poster');
      if (s && s.parentNode) s.parentNode.removeChild(s);
      showNav();
      return;
    }
    sessionStorage.setItem('mjm_splash_shown', '1');
  } catch (_) {}

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

  var cdEl = document.getElementById('splash-cd');
  var cdNum = 3;
  var cdInterval = setInterval(function() {
    cdNum--;
    if (cdEl) cdEl.textContent = cdNum;
    if (cdNum <= 0) clearInterval(cdInterval);
  }, 1000);

  setTimeout(dismissSplash, 3000);
  setTimeout(function() {
    var s = document.getElementById('splash-poster');
    if (s && !s.classList.contains('fade-out')) dismissSplash();
  }, 8000);

  var splashEl = document.getElementById('splash-poster');
  if (splashEl) splashEl.addEventListener('click', dismissSplash);
}
