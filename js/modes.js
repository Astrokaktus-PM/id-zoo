// Режимы дня. Названия и общее время участия — из макета v1.5 (экран «Режим дня»).
// Вклад каждого пункта в каналы — КАЛИБРОВКА, не данные: в d5_model.py режимов нет.
// Итог плана по модели не зашит сюда, а считается в интерфейсе тем же d5().
//
// П12 (ТЗ, разделы 2–3): время пунктов больше не зашито. Пользователь задаёт время
// ключевых действий питомца (подъём, утренняя, дневная, вечерняя прогулки, 2–3 кормления),
// а пункты режима ставятся относительно них — поле when:
//   { k: 'morning' | 'midday' | 'evening' }  — само ключевое действие;
//   { k: 'feed', i: 0 | 1 | 'last' }        — у кормления;
//   { after: ключ, min: N }                 — через N минут после ключевого;
//   { before: ключ, min: N }                — за N минут до ключевого;
//   { between: [ключ, ключ] }               — посередине между двумя.
// Пункт, который не помещается между ключевыми действиями или завязан на отсутствующий
// дневной выход, не показывается вовсе. Ни один пункт не ставится раньше подъёма.
//
// Отметка пункта = отметки в domain_entries с source='plan' и plan_item='режим:пункт'.

export const MODES = {
  dog: [
    // Базовые будние режимы (ТЗ П12, раздел 2). Одиночество меняет пункты и подсказки,
    // а не потолок среды: снижать потолок за то, что человек на работе, нельзя.
    { id: 'alone', icon: '🗝️', name: 'Будни, дома никого', base: true,
      about: 'Питомец один 8–10 часов: плотное утро, дневной выход или выгульщик, длинный вечер',
      items: [
        { id: 'walk',   when: { k: 'morning' }, text: 'Плотная утренняя прогулка: обнюхивание, маршрут выбирает собака', min: 40, ch: { move: 30, nose: 15, choice: 30 } },
        { id: 'feeder', when: { k: 'feed', i: 0 }, text: 'Кормушка-головоломка на время, пока никого нет', min: 0, ch: { nose: 10 } },
        { id: 'mid',    when: { k: 'midday' }, text: 'Дневной выход: сами или выгульщик', min: 20, ch: { move: 20, choice: 10 } },
        { id: 'eve',    when: { k: 'evening' }, text: 'Длинная вечерняя прогулка', min: 50, ch: { move: 40, nose: 10, choice: 20 } },
        { id: 'play',   when: { after: 'evening', min: 90 }, text: 'Игра или тренировка дома', min: 20, ch: { social: 20 } },
      ] },
    { id: 'someone', icon: '🏡', name: 'Будни, дома кто-то есть', base: true,
      about: 'Нагрузка распределена по дню: дневной выход короче, больше коротких контактов',
      items: [
        { id: 'walk',  when: { k: 'morning' }, text: 'Утренняя прогулка с обнюхиванием', min: 30, ch: { move: 20, nose: 10, choice: 20 } },
        { id: 'touch', when: { after: 'morning', min: 120 }, text: 'Короткий контакт: игра 10 минут', min: 10, ch: { social: 10 } },
        { id: 'mid',   when: { k: 'midday' }, text: 'Короткий дневной выход', min: 15, ch: { move: 15, choice: 10 } },
        { id: 'mat',   when: { before: 'evening', min: 90 }, text: 'Нюхательный коврик', min: 10, ch: { nose: 10 } },
        { id: 'eve',   when: { k: 'evening' }, text: 'Вечерняя прогулка', min: 40, ch: { move: 30, nose: 10, choice: 15 } },
        { id: 'play',  when: { after: 'evening', min: 90 }, text: 'Вечерняя игра', min: 15, ch: { social: 15 } },
      ] },
    { id: 'weekend', icon: '☀️', name: 'Выходной', base: true,
      about: 'Длинная прогулка, тренировка, новое место',
      items: [
        { id: 'long',  when: { k: 'morning' }, text: 'Длинная прогулка в новом месте', min: 90, ch: { move: 60, nose: 20, choice: 40, social: 15, novel: 1 } },
        { id: 'train', when: { between: ['morning', 'midday'] }, text: 'Тренировка, 20 минут', min: 20, ch: { social: 20 } },
        { id: 'dogs',  when: { k: 'midday' }, text: 'Встреча с другой собакой', min: 30, ch: { social: 15, move: 15 } },
        { id: 'eve',   when: { k: 'evening' }, text: 'Вечерняя прогулка', min: 40, ch: { move: 30, nose: 10, choice: 15 } },
      ] },
    // Ситуативные — выбираются на день вручную.
    { id: 'home', icon: '💻', name: 'Работаю из дома',
      about: 'Короткие выходы, игры между задачами',
      items: [
        { id: 'walk',  when: { k: 'morning' }, text: 'Утренняя прогулка с обнюхиванием, маршрут выбирает собака', min: 30, ch: { move: 30, nose: 10, choice: 30 } },
        { id: 'mat',   when: { between: ['morning', 'midday'] }, text: 'Нюхательный коврик', min: 10, ch: { nose: 10 } },
        { id: 'out',   when: { k: 'midday' }, text: 'Дневной выход', min: 20, ch: { move: 20, choice: 10 } },
        { id: 'play',  when: { after: 'evening', min: 90 }, text: 'Вечерняя игра дома', min: 20, ch: { social: 20 } },
      ] },
    { id: 'busy', icon: '🔥', name: 'Сегодня завал',
      about: 'Минимум времени, максимум нагрузки носом и выбором',
      items: [
        { id: 'walk',   when: { k: 'morning' }, text: 'Прогулка с обнюхиванием. Не тяните поводок — дайте выбрать, куда идти', min: 20, ch: { move: 20, nose: 10, choice: 20 } },
        { id: 'feeder', when: { k: 'feed', i: 0 }, text: 'Кормушка-головоломка вместо миски', min: 0, ch: { nose: 10 } },
        { id: 'train',  when: { after: 'evening', min: 30 }, text: 'Короткий тренировочный блок: «ищи» по квартире', min: 12, ch: { social: 12 } },
        { id: 'play',   when: { after: 'evening', min: 120 }, text: 'Игра: перетягивание или мяч', min: 15, ch: { social: 15 } },
      ] },
    { id: 'rain', icon: '🌧️', name: 'Плохая погода',
      about: 'Всё переносится в квартиру, нагрузка носом',
      items: [
        { id: 'walk',   when: { k: 'morning' }, text: 'Короткий выход, маршрут выбирает собака', min: 20, ch: { move: 20, choice: 20 } },
        { id: 'search', when: { between: ['morning', 'midday'] }, text: 'Поиск лакомств по квартире', min: 15, ch: { nose: 15 } },
        { id: 'feeder', when: { k: 'feed', i: 'last' }, text: 'Кормушка-головоломка', min: 0, ch: { nose: 10 } },
        { id: 'tug',    when: { after: 'evening', min: 30 }, text: 'Перетягивание', min: 20, ch: { social: 20, move: 10 } },
      ] },
    { id: 'recovery', icon: '🩹', name: 'После болезни',
      about: 'Ограничение нагрузки, короткие выходы',
      items: [
        { id: 'walk1', when: { k: 'morning' }, text: 'Короткий спокойный выход', min: 10, ch: { move: 10, nose: 5, choice: 10 } },
        { id: 'walk2', when: { k: 'evening' }, text: 'Короткий спокойный выход', min: 10, ch: { move: 10, nose: 5, choice: 10 } },
        { id: 'calm',  when: { after: 'evening', min: 90 }, text: 'Спокойный контакт: груминг, массаж', min: 20, ch: { social: 20 } },
      ] },
  ],
  // Для кошки в макете режимов нет. Не выдумываем — только ручные отметки и свои режимы.
  cat: [],
};

/** Распорядок по умолчанию, пока пользователь не задал свой (совпадает с default в sql/012). */
export const DEFAULT_SCHEDULE = { wake_at: '07:00', morning_at: '07:20', midday_at: '13:00', evening_at: '19:30', feeds: ['07:45', '19:00'], weekday_mode: 'alone' };

/** Режим по умолчанию (ТЗ П12, раздел 2): будни — «Будни, дома никого» или
 *  «дома кто-то есть» по выбору в распорядке; суббота и воскресенье — «Выходной».
 *  Правило «дождь сильнее 3 мм/ч → Плохая погода» требует погодного API — не сделано. */
export function defaultMode(species, isoDay, sched) {
  if (!MODES[species] || !MODES[species].length) return null;
  const wd = new Date(isoDay + 'T12:00:00').getDay();
  if (wd === 0 || wd === 6) return 'weekend';
  return (sched && sched.weekday_mode) === 'someone' ? 'someone' : 'alone';
}

export const findMode = (species, id) => (MODES[species] || []).find(m => m.id === id) || null;

/* ── расстановка пунктов по распорядку ─────────────────── */

const toMin = t => { if (!t) return null; const [h, m] = String(t).slice(0, 5).split(':').map(Number); return h * 60 + m; };
const toHm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const END = 23 * 60 + 30;   // позже 23:30 пункт не ставим

/** Ключевые моменты дня в минутах от полуночи. */
export function anchors(sched) {
  const s = { ...DEFAULT_SCHEDULE, ...(sched || {}) };
  const feeds = (s.feeds || []).map(toMin).filter(x => x != null).sort((a, b) => a - b);
  return { wake: toMin(s.wake_at), morning: toMin(s.morning_at), midday: toMin(s.midday_at), evening: toMin(s.evening_at), feeds };
}

function keyTime(A, k, i) {
  if (k === 'feed') return i === 'last' ? A.feeds[A.feeds.length - 1] ?? null : A.feeds[i] ?? null;
  return A[k] ?? null;
}

/** Время пункта или null, если пункт сегодня не помещается. */
export function placeItem(when, A) {
  const keys = [A.morning, A.midday, A.evening].filter(x => x != null).sort((a, b) => a - b);
  const next = t => keys.find(x => x > t) ?? END + 1;
  const prev = t => [...keys].reverse().find(x => x < t) ?? A.wake;
  let t = null;
  if (!when) return null;
  if (when.k) t = keyTime(A, when.k, when.i);
  else if (when.after) { const b = keyTime(A, when.after); if (b == null) return null; t = b + when.min; if (t >= next(b)) return null; }
  else if (when.before) { const b = keyTime(A, when.before); if (b == null) return null; t = b - when.min; if (t <= prev(b)) return null; }
  else if (when.between) { const [x, y] = when.between.map(k => keyTime(A, k)); if (x == null || y == null || y <= x) return null; t = Math.round((x + y) / 2 / 5) * 5; }
  if (t == null || t < A.wake || t > END) return null;
  return t;
}

/** Пункты режима на день: со временем по распорядку, по порядку, без непоместившихся.
 *  У своих режимов (П11) время задано явно: оно и берётся; без времени — в конце. */
export function resolveItems(mode, sched) {
  const A = anchors(sched);
  const out = [];
  for (const it of mode.items) {
    if (it.when) { const t = placeItem(it.when, A); if (t != null) out.push({ ...it, at: toHm(t), _t: t }); }
    else out.push({ ...it, _t: it.at ? toMin(it.at) : 24 * 60 });
  }
  return out.sort((a, b) => a._t - b._t);
}
