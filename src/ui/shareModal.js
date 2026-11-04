// UX-7 V1: export metadata collected at share time. A local modal in front
// of the existing HTML export flow; nothing here is inferred. Cancel leaves
// the dashboard untouched; Download hands the collected values back.
import { focusDialog } from './focus.js';
import { META_MAX_LENGTH, metaFromInputs } from '../data/layoutMeta.js';

let open = null;

export function closeShareModal() {
  if (!open) return;
  const { backdrop, release } = open;
  open = null;
  backdrop.remove();
  release();
}

export function openShareModal({ meta, trigger, onDownload }) {
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
    input.maxLength = META_MAX_LENGTH;
    input.autocomplete = 'off';
    input.value = meta?.[key] ?? '';
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
    const values = metaFromInputs(Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, input.value])));
    closeShareModal();
    onDownload(values);
  });
  backdrop.addEventListener('pointerdown', event => { if (event.target === backdrop) closeShareModal(); });
  backdrop.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); closeShareModal(); } }, true);
  backdrop.append(panel);
  document.body.append(backdrop);
  open = { backdrop, release: focusDialog(panel, trigger) };
  fields.title.focus();
}
