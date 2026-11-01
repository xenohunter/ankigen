// @ts-check
// The support links at the top of the page. After the first download they are sticky: while their place in the
// header is out of view they are pinned to the top of the window, sliding down from its edge; back at the top
// of the page they are in the header again, where they cover nothing. Their place keeps its size meanwhile, so
// nothing moves, and on wide screens the pinned links end where that place ends.

/**
 * @param {HTMLElement} block the support links in the header (their parent is their place)
 */
export function mountSupport(block) {
  const place = /** @type {HTMLElement} */ (block.parentElement);
  let sticky = false;
  let pinned = false;

  // The gap between the place's end (its right edge, or its left one right to left) and the window's edge.
  const align = () => {
    const r = place.getBoundingClientRect();
    const end = document.documentElement.dir === 'rtl' ? r.left : document.documentElement.clientWidth - r.right;
    block.style.setProperty('--pin-end', `${Math.max(0, end)}px`);
  };

  /** @param {boolean} on */
  function pin(on) {
    if (on === pinned) return;
    pinned = on;
    if (on) {
      const { width, height } = block.getBoundingClientRect();
      place.style.minWidth = `${width}px`;
      place.style.minHeight = `${height}px`;
      align();
    } else {
      place.style.minWidth = place.style.minHeight = '';
    }
    block.classList.toggle('is-pinned', on);
  }

  const observer = new IntersectionObserver(([entry]) => pin(!entry.isIntersecting));

  return {
    /** From now on the links stay in sight (a later download changes nothing). */
    stick() {
      if (sticky) return;
      sticky = true;
      observer.observe(place);
      window.addEventListener('resize', align);
    },
  };
}
