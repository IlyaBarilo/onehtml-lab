export async function libraryMenu(page, name) {
  if (await page.locator(`#library-${name}-menu`).isHidden()) await page.locator(`#library-${name}-open`).click();
}
export async function libraryTab(page, name) {
  await page.locator(`#library-tab-${name}`).click();
}
