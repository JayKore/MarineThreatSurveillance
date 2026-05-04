/* ============================================================
   MARINE THREAT SURVEILLANCE — SHARED CLIENT JS
   Navbar, scroll reveal, custom cursor, auth modal, session state
   ============================================================ */

(function () {
  // ---- NAV: scrolled state + active link + hamburger -------------------
  const nav = document.getElementById('nav');
  const navLinks = document.getElementById('nav-links');
  const hamburger = document.getElementById('nav-hamburger');

  const setNavScrolled = () => {
    if (!nav) return;
    nav.classList.toggle('scrolled', window.scrollY > 80);
  };
  setNavScrolled();
  window.addEventListener('scroll', setNavScrolled, { passive: true });

  if (hamburger) {
    hamburger.addEventListener('click', () => nav.classList.toggle('is-open'));
  }

  // active link based on path
  const path = window.location.pathname.replace(/\/$/, '') || '/';
  document.querySelectorAll('.nav__links a').forEach((a) => {
    const href = a.getAttribute('href');
    if (href && (href === path || (href !== '/' && path.startsWith(href)))) {
      a.classList.add('active');
    }
  });

  // ---- SCROLL REVEAL --------------------------------------------------
  const reveals = document.querySelectorAll('.reveal');
  if (reveals.length) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('is-visible');
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12 }
    );
    reveals.forEach((el) => io.observe(el));
  }

  // ---- COUNTER ANIMATIONS ---------------------------------------------
  const counters = document.querySelectorAll('[data-counter]');
  const animateCounter = (el) => {
    const target = parseFloat(el.dataset.counter);
    const isFloat = !Number.isInteger(target);
    const prefix = el.dataset.prefix || '';
    const suffix = el.dataset.suffix || '';
    const duration = 1400;
    const start = performance.now();

    const tick = (now) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      const v = target * eased;
      el.textContent = prefix + (isFloat ? v.toFixed(1) : Math.round(v).toLocaleString()) + suffix;
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  if (counters.length) {
    const counterIO = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            animateCounter(e.target);
            counterIO.unobserve(e.target);
          }
        });
      },
      { threshold: 0.3 }
    );
    counters.forEach((c) => counterIO.observe(c));
  }

  // ---- MODAL: open/close generic --------------------------------------
  const openModal = (id) => document.getElementById(id)?.classList.add('open');
  const closeModal = (el) => el.classList.remove('open');

  document.querySelectorAll('[data-close-modal]').forEach((b) => {
    b.addEventListener('click', () => {
      const m = b.closest('.modal');
      if (m) closeModal(m);
    });
  });
  document.querySelectorAll('.modal').forEach((m) => {
    m.addEventListener('click', (e) => { if (e.target === m) closeModal(m); });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') document.querySelectorAll('.modal.open').forEach(closeModal);
  });

  window.MTS = window.MTS || {};
  window.MTS.openModal = openModal;
  window.MTS.closeModal = closeModal;

  // ---- AUTH MODAL -----------------------------------------------------
  let authMode = 'login';
  const authModal = document.getElementById('auth-modal');
  const authTitle = document.getElementById('auth-title');
  const authForm = document.getElementById('auth-form');
  const emailField = document.getElementById('email-field');
  const switchText = document.getElementById('auth-switch-text');
  const switchLink = document.getElementById('auth-switch-link');
  const authError = document.getElementById('auth-error');

  const setAuthMode = (mode) => {
    authMode = mode;
    if (!authModal) return;
    authTitle.textContent = mode === 'signup' ? 'Sign Up' : 'Login';
    emailField.hidden = mode !== 'signup';
    emailField.querySelector('input').required = mode === 'signup';
    switchText.textContent = mode === 'signup' ? 'Already have an account?' : 'No account?';
    switchLink.textContent = mode === 'signup' ? 'Login' : 'Sign up';
    authError.classList.remove('show');
    authError.textContent = '';
  };

  document.querySelectorAll('[data-open-auth]').forEach((b) => {
    b.addEventListener('click', () => {
      setAuthMode(b.dataset.openAuth);
      openModal('auth-modal');
    });
  });

  if (switchLink) {
    switchLink.addEventListener('click', (e) => {
      e.preventDefault();
      setAuthMode(authMode === 'login' ? 'signup' : 'login');
    });
  }

  if (authForm) {
    authForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      authError.classList.remove('show');
      const fd = new FormData(authForm);
      const payload = {
        username: fd.get('username'),
        password: fd.get('password'),
      };
      if (authMode === 'signup') payload.email = fd.get('email');

      try {
        const res = await fetch(`/auth/${authMode}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Authentication failed');
        applyAuthState(data.user);
        closeModal(authModal);
        authForm.reset();
      } catch (err) {
        authError.textContent = err.message;
        authError.classList.add('show');
      }
    });
  }

  // ---- AUTH STATE -----------------------------------------------------
  const authOut = document.getElementById('auth-out');
  const authIn = document.getElementById('auth-in');
  const avatar = document.getElementById('avatar');
  const avatarInitials = document.getElementById('avatar-initials');
  const usernameEl = document.getElementById('auth-username');
  const logoutBtn = document.getElementById('logout-btn');

  const applyAuthState = (user) => {
    if (user) {
      authOut.hidden = true;
      authIn.hidden = false;
      avatarInitials.textContent = (user.avatar_initials || user.username.slice(0, 2)).toUpperCase();
      usernameEl.textContent = user.username;
    } else {
      authOut.hidden = false;
      authIn.hidden = true;
    }
  };

  if (avatar) {
    avatar.addEventListener('click', (e) => {
      e.stopPropagation();
      avatar.classList.toggle('open');
    });
    document.addEventListener('click', () => avatar.classList.remove('open'));
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await fetch('/auth/logout', { method: 'POST' });
      applyAuthState(null);
      // if on dashboard, send home
      if (window.location.pathname.includes('/dashboard')) window.location.href = '/';
    });
  }

  // bootstrap session
  fetch('/auth/me')
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => applyAuthState(data?.user || null))
    .catch(() => applyAuthState(null));

  window.MTS.applyAuthState = applyAuthState;
  window.MTS.requireAuth = () => fetch('/auth/me').then((r) => r.ok);

  // ---- CUSTOM CURSOR --------------------------------------------------
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    document.body.classList.add('cursor-on');
    const dot = document.getElementById('cursor-dot');
    const ring = document.getElementById('cursor-ring');
    if (dot && ring) {
      dot.hidden = false;
      ring.hidden = false;
      let mx = window.innerWidth / 2, my = window.innerHeight / 2;
      let rx = mx, ry = my;
      window.addEventListener('mousemove', (e) => {
        mx = e.clientX; my = e.clientY;
        dot.style.left = mx + 'px';
        dot.style.top = my + 'px';
      });
      const tick = () => {
        rx += (mx - rx) * 0.18;
        ry += (my - ry) * 0.18;
        ring.style.left = rx + 'px';
        ring.style.top = ry + 'px';
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);

      const interactive = 'a, button, .feature-card, .detect-card, .history-card, .upload, .avatar, [data-open-auth]';
      document.addEventListener('mouseover', (e) => {
        if (e.target.closest(interactive)) ring.classList.add('is-active');
      });
      document.addEventListener('mouseout', (e) => {
        if (e.target.closest(interactive)) ring.classList.remove('is-active');
      });
    }
  }
})();
