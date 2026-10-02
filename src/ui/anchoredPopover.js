// Keep an expanding fixed-position dialog inside the viewport. Observe content
// as well as size: an already capped panel may grow without changing its box.
export function anchorPopover(popover, anchor) {
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
    const below = rect.bottom + 6;
    const above = rect.top - ph - 6;
    const preferred = below + ph <= height - margin ? below : above;
    popover.style.left = `${Math.max(margin, Math.min(rect.left, width - pw - margin))}px`;
    popover.style.top = `${Math.max(margin, Math.min(preferred, height - ph - margin))}px`;
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
  schedule();
  return () => {
    cancelAnimationFrame(frame);
    resize.disconnect(); changes.disconnect();
    window.removeEventListener('resize', schedule);
    document.removeEventListener('scroll', schedule, true);
  };
}
