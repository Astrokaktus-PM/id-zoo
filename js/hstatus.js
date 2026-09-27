// Сроки и статусы карты здоровья. Чистые функции — проверяются в test/health_check.mjs.
//
// Срок процедуры не хранится: valid_until, а если его нет — done_on + repeat_days.
// Актуальна последняя запись с тем же типом и названием: новая прививка
// закрывает срок старой.

export const SOON_DAYS = 30;          // «требует внимания» — просрочено или в ближайшие 30 дней
export const GATE_KINDS = ['vaccine', 'parasite'];

const MS = 86400000;
const toDay = iso => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / MS;
export const addDays = (iso, n) => new Date((toDay(iso) + n) * MS).toISOString().slice(0, 10);
export const diffDays = (a, b) => toDay(a) - toDay(b);          // a − b, в днях

export function dueOf(r) {
  if (r.valid_until) return r.valid_until;
  if (r.repeat_days) return addDays(r.done_on, r.repeat_days);
  return null;
}

export const keyOf = r => `${r.kind}|${r.title.trim().toLowerCase().replace(/\s+/g, ' ')}`;

/** Последняя запись по каждому ключу среди сделанных не позже дня asOf. */
export function latest(records, asOf = null) {
  const m = new Map();
  for (const r of records) {
    if (asOf && r.done_on > asOf) continue;
    const k = keyOf(r), cur = m.get(k);
    if (!cur || r.done_on > cur.done_on || (r.done_on === cur.done_on && r.created_at > cur.created_at)) m.set(k, r);
  }
  return [...m.values()];
}

/** overdue | soon | ok | none — на день today. */
export function status(r, today, soon = SOON_DAYS) {
  const due = dueOf(r);
  if (!due) return 'none';
  const d = diffDays(due, today);
  if (d < 0) return 'overdue';
  if (d <= soon) return 'soon';
  return 'ok';
}

/** Что требует внимания: просроченное и близкое, по сроку. */
export function attention(records, today) {
  return latest(records, today)
    .map(r => ({ r, due: dueOf(r), st: status(r, today) }))
    .filter(x => x.st === 'overdue' || x.st === 'soon')
    .sort((a, b) => a.due < b.due ? -1 : a.due > b.due ? 1 : 0);
}

/** Системная степень домена 3 на день X.
 *  Спецификация пятого домена, раздел 04: «B — лёгкая: просрочена обработка от
 *  паразитов». Прививку с истёкшим сроком приравниваем к тому же уровню.
 *  Больше B система не ставит: C–E — это боль и болезнь, их отмечает человек
 *  или врач, модель диагнозов не ставит. */
export function autoHealth(records, X) {
  const over = latest(records, X).filter(r => GATE_KINDS.includes(r.kind) && status(r, X) === 'overdue');
  if (!over.length) return null;
  over.sort((a, b) => dueOf(a) < dueOf(b) ? -1 : 1);
  return { grade: 'B', because: over };
}

const ORDER = 'ABCDE';
export const worse = (a, b) => (ORDER.indexOf(a || 'A') >= ORDER.indexOf(b || 'A') ? (a || 'A') : b);

/** Напоминания на сегодня: срок наступил, просрочен или попадает в заданные
 *  отступы (за 0/3/7/30 дней) — берётся самый ранний из отступов. */
export function remindersToday(items, today, offsetsFor) {
  return items.filter(x => {
    if (!x.due) return false;
    const d = diffDays(x.due, today);
    if (d < 0) return true;
    const offs = offsetsFor(x.kind) || [0];
    return d <= Math.max(...offs);
  });
}
