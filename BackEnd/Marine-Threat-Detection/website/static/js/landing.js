/* Landing page extras — currently the heavy lifting is done in main.js
   (counters + scroll reveals are generic).
   Hook in here if you want bespoke landing animations later. */
(function () {
  // smooth scroll for in-page anchor links
  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href');
      if (id.length <= 1) return;
      const target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
})();
