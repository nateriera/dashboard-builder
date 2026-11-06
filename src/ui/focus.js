// Live focus traps, oldest first. Only the most recently registered trap that
// is still connected acts on Tab and focusin: two independent document-level
// traps would each redirect focus out of the other, re-entering each other's
// focusin synchronously until the stack overflows (F-SHARE-1). Releasing the
// top trap hands control back to the one beneath it.
const traps = [];
const activeTrap = () => traps.findLast(trap => trap.dialog.isConnected);

export function focusDialog(dialog, trigger = document.activeElement) {
  dialog.setAttribute('role','dialog');
  dialog.setAttribute('aria-modal','true');
  dialog.tabIndex = -1;
  const controls = () => [...dialog.querySelectorAll('button,input,select,textarea,summary,[tabindex="0"]')].filter(e => !e.disabled && !e.closest('[hidden]') && e.getClientRects().length);
  const trap = { dialog };
  const keydown = e => {
    if (e.key !== 'Tab' || activeTrap() !== trap) return;
    const items = controls();
    if (!items.length) { e.preventDefault(); dialog.focus(); return; }
    const first = items[0], last = items.at(-1);
    if (!dialog.contains(document.activeElement) || document.activeElement === dialog || (e.shiftKey && document.activeElement === first) || (!e.shiftKey && document.activeElement === last)) {
      e.preventDefault(); (e.shiftKey ? last : first).focus();
    }
  };
  const focusin = e => { if (activeTrap() === trap && !dialog.contains(e.target)) (controls()[0] || dialog).focus(); };
  traps.push(trap);
  document.addEventListener('keydown',keydown,true);
  document.addEventListener('focusin',focusin);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (activeTrap() === trap && !dialog.contains(document.activeElement)) (controls()[0] || dialog).focus();
  }));
  return () => {
    const index = traps.indexOf(trap);
    if (index !== -1) traps.splice(index, 1);
    document.removeEventListener('keydown',keydown,true);
    document.removeEventListener('focusin',focusin);
    if (trigger?.isConnected) trigger.focus();
  };
}
