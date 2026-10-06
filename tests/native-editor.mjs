// Existing editing and application scenarios explicitly exercise the native
// editor. Fresh-default CodeMirror and display controls have their own checks.
export async function useNativeEditor(page) {
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const select = document.querySelector('#editor-engine');
      if (!select) return; // Exported game documents are not editor fixtures.
      select.value = 'native';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }, { once: true });
  });
}
