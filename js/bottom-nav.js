/**
 * LaLanguish — Shared Bottom Navigation
 * Single source of truth for the bottom nav bar.
 * Include this script on every page; it builds and injects the nav automatically.
 */
(function () {
  const TABS = [
    { href: 'index.html',    icon: '🏠', label: 'Inicio'   },
    { href: 'practice.html', icon: '📍', label: 'Práctica' },
    { href: 'chat.html',     icon: '🌙', label: 'Luna'     },
    { href: 'progress.html', icon: '🗺️', label: 'Progreso' },
  ];

  // Match the current page filename (works from any path depth)
  const currentPage = location.pathname.split('/').pop() || 'index.html';

  const nav = document.createElement('nav');
  nav.className = 'bottom-nav';
  nav.setAttribute('role', 'navigation');
  nav.setAttribute('aria-label', 'Navegación principal');

  TABS.forEach(function (tab) {
    const isActive = currentPage === tab.href;
    const a = document.createElement('a');
    a.href = tab.href;
    a.className = 'nav-item' + (isActive ? ' active' : '');
    if (isActive) a.setAttribute('aria-current', 'page');
    a.innerHTML =
      '<span class="nav-icon" aria-hidden="true">' + tab.icon + '</span>' +
      '<span class="nav-label">' + tab.label + '</span>';
    nav.appendChild(a);
  });

  // Inject into the placeholder div, or fall back to appending to body
  const container = document.getElementById('bottom-nav');
  if (container) {
    container.appendChild(nav);
  } else {
    document.body.appendChild(nav);
  }
})();
