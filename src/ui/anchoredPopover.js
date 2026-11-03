// Keep an expanding fixed-position dialog inside the viewport. Observe content
// as well as size: an already capped panel may grow without changing its box.
export function anchorPopover(popover, anchor, { preferBelow = false, minTop = 0 } = {}) {
  let frame = 0;
  const position = () => {
    frame = 0;
    if (!popover.isConnected || !anchor.isConnected) return;
    const margin = 8;
    const width = window.innerWidth, height = window.innerHeight;
    popover.style.maxWidth = `${Math.max(0, width - margin * 2)}px`;
    popover.style.maxHeight = `${Math.max(0, height - margin * 2)}px`;
    const rect = anchor.getBoundingClientRect();
    const { offsetWidth: pw, offsetHeight: ph } = popover;
    const below = Math.max(rect.bottom + 6, minTop);
    const belowSpace = Math.max(0, height - margin - below);
    const aboveSpace = Math.max(0, rect.top - margin - 6);
    const placeBelow = preferBelow || ph <= belowSpace || belowSpace >= aboveSpace;
    const available = placeBelow ? belowSpace : aboveSpace;
    popover.style.maxHeight = `${available}px`;
    const preferred = placeBelow ? below : rect.top - Math.min(ph, available) - 6;
    popover.style.left = `${Math.max(margin, Math.min(rect.left, width - pw - margin))}px`;
    popover.style.top = `${preferred}px`;
    popover.style.visibility = 'visible';
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(position);
  };
  const resize = new ResizeObserver(schedule);
  resize.observe(popover);
  const changes = new MutationObserver(schedule);
  // Exclude our positioning styles so this observer cannot schedule itself.
  changes.observe(popover, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'class'] });
  window.addEventListener('resize', schedule);
  document.addEventListener('scroll', schedule, true);
  document.addEventListener('pointermove', schedule, true);
  schedule();
  return () => {
    cancelAnimationFrame(frame);
    resize.disconnect(); changes.disconnect();
    window.removeEventListener('resize', schedule);
    document.removeEventListener('scroll', schedule, true);
    document.removeEventListener('pointermove', schedule, true);
  };
}
