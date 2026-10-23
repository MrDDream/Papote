// Admin pages: the only script, served from our own origin. Everything works without it; it only makes
// list filters instant (as you type) and the filter menus apply on change.
const fold = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

for (const form of document.querySelectorAll('form[data-live]')) {
  const input = form.querySelector('input[name="q"]');
  const count = form.querySelector('.count');
  const tables = [...document.querySelectorAll('[data-filterable]')];
  const apply = () => {
    const words = fold(input.value).split(/\s+/).filter(Boolean);
    let shown = 0;
    let total = 0;
    for (const t of tables) {
      for (const row of t.querySelectorAll('tbody tr, li')) {
        total++;
        // Only the meaningful fields (a name, a code…), not "jamais" in a date column.
        const text = fold(row.dataset.search ?? row.textContent);
        const ok = words.every((w) => text.includes(w));
        row.hidden = !ok;
        if (ok) shown++;
      }
    }
    if (count) count.textContent = words.length ? `${shown} sur ${total}` : `${total}`;
  };
  input?.addEventListener('input', apply);
  for (const select of form.querySelectorAll('select')) select.addEventListener('change', () => form.requestSubmit());
  form.querySelector('button[type="submit"]')?.classList.add('js-hidden');
}
