// UX-7 V1: export metadata collected at share time. A local modal in front
// of the existing HTML export flow; nothing here is inferred. Cancel leaves
// the dashboard untouched; Download hands the collected values back.
import { focusDialog } from './focus.js';
import { META_MAX_LENGTH, metaFromInputs, SHARE_NOTE_MAX_LENGTH, shareNoteFromInput } from '../data/layoutMeta.js';
import { validatePassword } from '../export/protect.js';

let open = null;

export function closeShareModal() {
  if (!open) return;
  const { backdrop, release } = open;
  open = null;
  backdrop.remove();
  release();
}

export function openShareModal({ meta, note, trigger, onDownload }) {
  if (open) return;
  const backdrop = document.createElement('div');
  backdrop.className = 'share-modal-backdrop';
  const panel = document.createElement('form');
  panel.className = 'share-modal-panel';
  panel.noValidate = true;
  panel.setAttribute('aria-labelledby', 'share-modal-heading');
  const heading = document.createElement('h2');
  heading.id = 'share-modal-heading';
  heading.textContent = 'Share as HTML';
  const intro = document.createElement('p');
  intro.className = 'share-modal-intro';
  intro.textContent = 'These details appear at the top of the exported file. All are optional.';
  panel.append(heading, intro);

  const fields = {};
  const field = (key, labelText, helpText) => {
    const label = document.createElement('label');
    label.className = 'share-modal-field';
    const name = document.createElement('span');
    name.textContent = labelText;
    const input = document.createElement('input');
    input.type = 'text';
    input.name = key;
    input.maxLength = key === 'note' ? SHARE_NOTE_MAX_LENGTH : META_MAX_LENGTH;
    input.autocomplete = 'off';
    input.value = key === 'note' ? (note ?? '') : (meta?.[key] ?? '');
    label.append(name, input);
    const group = document.createElement('div');
    group.className = 'share-modal-field-group';
    group.append(label);
    if (helpText) {
      // Outside the label so the field's accessible name stays its label.
      const help = document.createElement('p');
      help.className = 'share-modal-help';
      help.id = `share-modal-${key}-help`;
      help.textContent = helpText;
      input.setAttribute('aria-describedby', help.id);
      group.append(help);
    }
    fields[key] = input;
    panel.append(group);
  };
  field('title', 'Dashboard title');
  field('preparedBy', 'Prepared by');
  field('dataPeriod', 'Data period', 'Describe the dates covered by the data. This is not the export date.');
  field('note', 'Cover note', `One plain-text paragraph, up to ${SHARE_NOTE_MAX_LENGTH} characters. Included only in the shared file.`);

  // Password protection (§6.1): opt-in, default off. The password is handed
  // to onDownload as a separate argument — it is never written into the
  // layout metadata, never autosaved, never logged.
  const cryptoAvailable = typeof crypto !== 'undefined' && !!crypto.subtle;
  const protectGroup = document.createElement('div');
  protectGroup.className = 'share-modal-field-group';
  const protectLabel = document.createElement('label');
  protectLabel.className = 'share-modal-field';
  const protectCheckbox = document.createElement('input');
  protectCheckbox.type = 'checkbox';
  protectCheckbox.name = 'protect';
  protectCheckbox.disabled = !cryptoAvailable;
  const protectText = document.createElement('span');
  protectText.textContent = 'Protect with password';
  protectLabel.append(protectCheckbox, protectText);
  protectGroup.append(protectLabel);
  const protectHelp = document.createElement('p');
  protectHelp.className = 'share-modal-help';
  protectHelp.textContent = cryptoAvailable
    ? 'Anyone opening the file needs the password. There is no recovery — if you forget it, export again.'
    : 'Password protection needs WebCrypto, which this browser does not provide.';
  protectGroup.append(protectHelp);
  panel.append(protectGroup);

  const passwordGroup = document.createElement('div');
  passwordGroup.className = 'share-modal-field-group';
  passwordGroup.hidden = true;
  const passwordField = (key, labelText) => {
    const label = document.createElement('label');
    label.className = 'share-modal-field';
    const name = document.createElement('span');
    name.textContent = labelText;
    const input = document.createElement('input');
    input.type = 'password';
    input.name = key;
    input.autocomplete = 'new-password';
    label.append(name, input);
    passwordGroup.append(label);
    return input;
  };
  const passwordInput = passwordField('password', 'Password (at least 12 characters)');
  const confirmInput = passwordField('passwordConfirm', 'Confirm password');
  panel.append(passwordGroup);
  // A stale error must not linger once the user starts correcting the fields.
  for (const input of [passwordInput, confirmInput]) {
    input.addEventListener('input', () => { errorEl.hidden = true; });
  }

  const errorEl = document.createElement('p');
  errorEl.className = 'share-modal-error';
  errorEl.setAttribute('role', 'alert');
  errorEl.hidden = true;
  panel.append(errorEl);
  protectCheckbox.addEventListener('change', () => {
    passwordGroup.hidden = !protectCheckbox.checked;
    errorEl.hidden = true;
    if (protectCheckbox.checked) passwordInput.focus();
  });

  const actions = document.createElement('div');
  actions.className = 'share-modal-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', closeShareModal);
  const download = document.createElement('button');
  download.type = 'submit';
  download.className = 'share-modal-primary';
  download.textContent = 'Download dashboard HTML';
  actions.append(cancel, download);
  panel.append(actions);

  panel.addEventListener('submit', event => {
    event.preventDefault();
    let password = null;
    if (protectCheckbox.checked) {
      const problem = validatePassword(passwordInput.value, confirmInput.value);
      if (problem) {
        errorEl.textContent = problem;
        errorEl.hidden = false;
        passwordInput.focus();
        return;
      }
      password = passwordInput.value;
    }
    const values = metaFromInputs(Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, input.value])));
    passwordInput.value = '';
    confirmInput.value = '';
    closeShareModal();
    onDownload(values, password, shareNoteFromInput(fields.note.value));
  });
  backdrop.addEventListener('pointerdown', event => { if (event.target === backdrop) closeShareModal(); });
  backdrop.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); closeShareModal(); } }, true);
  backdrop.append(panel);
  document.body.append(backdrop);
  open = { backdrop, release: focusDialog(panel, trigger) };
  fields.title.focus();
}
