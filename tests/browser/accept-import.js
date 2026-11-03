// Existing import scenarios opt into the new replacement confirmation.
export async function configureImportContext(context) {
  await context.addInitScript(() => {
    const confirm = window.confirm;
    window.confirm = message => message.startsWith("Importing replaces the current dashboard") ? true : confirm(message);
  });
}
export function acceptImportConfirmation(test) {
  test.beforeEach(async ({ context }) => configureImportContext(context));
}

// HTML snapshot tests that assert successful downloads explicitly consent to
// the new required frozen-parameter/view-state confirmation. Other confirms
// retain Playwright's normal dialog behavior.
export function acceptExportSnapshotConfirmation(test) {
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
      const confirm = window.confirm.bind(window);
      window.confirm = message => {
        if (typeof message === 'string' && (message.startsWith('This export is a data snapshot.') || message.startsWith('These saved views will be disabled'))) return true;
        return confirm(message);
      };
    });
  });
}
