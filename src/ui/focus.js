export function focusDialog(dialog, trigger = document.activeElement) {
  dialog.setAttribute('role','dialog');
  dialog.setAttribute('aria-modal','true');
  dialog.tabIndex = -1;
  const controls = () => [...dialog.querySelectorAll('button,input,select,textarea,summary,[tabindex="0"]')].filter(e => !e.disabled && !e.closest('[hidden]') && e.getClientRects().length);
  const keydown = e => {
    if (e.key !== 'Tab') return;
    const items = controls();
    if (!items.length) { e.preventDefault(); dialog.focus(); return; }
    const first = items[0], last = items.at(-1);
    if (!dialog.contains(document.activeElement) || document.activeElement === dialog || (e.shiftKey && document.activeElement === first) || (!e.shiftKey && document.activeElement === last)) {
      e.preventDefault(); (e.shiftKey ? last : first).focus();
    }
  };
  const focusin = e => { if (!dialog.contains(e.target)) (controls()[0] || dialog).focus(); };
  document.addEventListener('keydown',keydown,true);
  document.addEventListener('focusin',focusin);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (dialog.isConnected && !dialog.contains(document.activeElement)) (controls()[0] || dialog).focus();
  }));
  return () => {
    document.removeEventListener('keydown',keydown,true);
    document.removeEventListener('focusin',focusin);
    if (trigger?.isConnected) trigger.focus();
  };
}
