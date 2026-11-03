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
