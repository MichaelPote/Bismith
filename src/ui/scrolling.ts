// Whether something on the page scrolled a moment ago — wheel-driven fields (dropdowns) let a wheel that is scrolling
// a panel past them keep scrolling instead of grabbing it.

let lastScroll = -Infinity

if (typeof document !== 'undefined') {
  document.addEventListener('scroll', () => (lastScroll = performance.now()), { capture: true, passive: true })
}

export const recentlyScrolled = (ms = 350): boolean => performance.now() - lastScroll < ms
