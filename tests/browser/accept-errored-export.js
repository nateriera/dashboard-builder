export async function configureErroredExportContext(context) {
  await context.addInitScript(() => {
    const confirm = window.confirm;
    window.confirm = message => message.startsWith("These tiles are in an error state and will export without their data:") ? true : confirm(message);
  });
}

export function acceptErroredTileExportConfirmation(test) {
  test.beforeEach(async ({context}) => configureErroredExportContext(context));
}
