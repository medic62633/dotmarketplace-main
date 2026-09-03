/* Premium dark theme — no toggle, one scheme across every surface. */
(function () {
  document.documentElement.setAttribute('data-theme', 'dark');
  document.documentElement.style.colorScheme = 'dark';
  try { localStorage.removeItem('dk_theme'); } catch (e) {}
})();
