import { modeMinutes, findMode } from './modes.js';
// Правила «помощника» для веб-макета. Это НЕ ИИ: дерево вопросов с ответами,
// каждое правило с источником. Проверка — test/triage_check.mjs.
//
// Источники:
//  AVMA — «13 animal emergencies that require immediate veterinary consultation
//         and/or care», American Veterinary Medical Association,
//         https://www.avma.org/public/EmergencyCare/Pages/animal-emergencies.aspx
//  MVM  — «What to Do in a Dog or Cat Emergency», Merck Veterinary Manual,
//         J. Textor, DVM, PhD, обзор дек. 2025,
//         https://www.merckvetmanual.com/special-pet-topics/emergencies/emergency-care-for-dogs-and-cats
//  D5   — спецификация «Как считается пятый домен», раздел 04: шкала A–E.
//
// Помощник не ставит диагнозов (PRD: «доводит до «покажите врачу» и
// останавливается»). Он решает одно: срочно, к врачу в плановом порядке или
// можно наблюдать, — и предлагает степень домена 3 по шкале из спецификации.

export const SRC = {
  AVMA: { name: 'AVMA — 13 неотложных состояний', url: 'https://www.avma.org/public/EmergencyCare/Pages/animal-emergencies.aspx' },
  MVM: { name: 'Merck Veterinary Manual — неотложные состояния собак и кошек', url: 'https://www.merckvetmanual.com/special-pet-topics/emergencies/emergency-care-for-dogs-and-cats' },
  D5: { name: 'Спецификация пятого домена, раздел 04 — шкала A–E', url: null },
};

// Признаки, при которых нужен врач сейчас. Формулировки — перевод пунктов AVMA
// и дополнений MVM, без добавлений от себя.
export const RED_FLAGS = [
  { id: 'bleeding', text: 'Сильное кровотечение или кровь не останавливается за 5 минут', src: 'AVMA' },
  { id: 'breathing', text: 'Задыхается, давится, не прекращает кашлять и давиться', src: ['AVMA', 'MVM'] },
  { id: 'blood', text: 'Кровь из носа, пасти, прямой кишки, кашель с кровью, кровь в моче', src: 'AVMA' },
  { id: 'urine', text: 'Не может помочиться или сходить в туалет, или делает это с явной болью', src: 'AVMA' },
  { id: 'eye', text: 'Травма глаза', src: 'AVMA' },
  { id: 'poison', text: 'Съел или мог съесть ядовитое: антифриз, ксилит, шоколад, отраву для грызунов', src: 'AVMA' },
  { id: 'seizure', text: 'Судороги или шатается', src: 'AVMA' },
  { id: 'fracture', text: 'Перелом, сильная хромота или не может двигать лапой', src: 'AVMA' },
  { id: 'pain', text: 'Явная боль или сильная тревога', src: 'AVMA' },
  { id: 'heat', text: 'Перегрев или тепловой удар: горячая кожа, частое дыхание, рвота, падает', src: ['AVMA', 'MVM'] },
  { id: 'vomit3', text: 'Рвота или понос больше двух раз за сутки, или вместе с явным недомоганием', src: 'AVMA' },
  { id: 'nodrink', text: 'Не пьёт сутки и дольше', src: 'AVMA' },
  { id: 'unconscious', text: 'Без сознания', src: 'AVMA' },
  { id: 'wound', text: 'Проникающая рана головы, груди или живота; травма шеи от удушения', src: 'MVM' },
];

// Жалобы, с которых начинается разговор, если красных флагов нет.
export const COMPLAINTS = [
  { id: 'limp', text: 'Хромает' },
  { id: 'gi', text: 'Рвота или понос' },
  { id: 'appetite', text: 'Плохо ест' },
  { id: 'itch', text: 'Чешется' },
  { id: 'other', text: 'Другое' },
];

/** Решение по ответам. a = { flags: [id…], complaint, episodes, canStep, drinks24, behaves }.
 *  Возвращает { level: 'now' | 'vet' | 'watch', grade: 'B'…'E', why: [..], src: [..] }. */
export function decide(a) {
  const flags = a.flags || [];
  if (flags.length) {
    const srcs = [...new Set(flags.flatMap(f => [].concat((RED_FLAGS.find(r => r.id === f) || {}).src || [])))];
    return { level: 'now', grade: 'E', why: flags.map(f => RED_FLAGS.find(r => r.id === f).text), src: [...srcs, 'D5'] };
  }
  // Пороги из AVMA, дошедшие до уточняющих вопросов.
  if (a.complaint === 'gi' && a.episodes != null && a.episodes > 2)
    return { level: 'now', grade: 'E', why: ['Больше двух эпизодов рвоты или поноса за сутки'], src: ['AVMA', 'D5'] };
  if (a.complaint === 'limp' && a.canStep === false)
    return { level: 'now', grade: 'E', why: ['Не может опираться на лапу'], src: ['AVMA', 'D5'] };
  if (a.drinks24 === false)
    return { level: 'now', grade: 'E', why: ['Не пьёт сутки и дольше'], src: ['AVMA', 'D5'] };

  // Дальше — шкала D5. D: «боль, меняющая поведение: отказывается от прогулки».
  // C: «видно, но ест и гуляет». B: «лёгкая: зуд». D и E — всегда «покажите врачу».
  if (a.behaves === false)
    return { level: 'vet', grade: 'D', why: ['Состояние меняет поведение: не ест или отказывается гулять'], src: ['D5'] };
  if (a.complaint === 'itch')
    return { level: 'watch', grade: 'B', why: ['Зуд без других признаков'], src: ['D5'] };
  return { level: 'vet', grade: 'C', why: ['Проблема заметна, но питомец ест и гуляет'], src: ['D5'] };
}

export const LEVEL_TEXT = {
  now: ['Нужен врач сейчас', 'Везите в ближайшую круглосуточную клинику. Позвоните по дороге, чтобы вас ждали.'],
  vet: ['Покажите врачу', 'Запишитесь на ближайший приём. Если появится любой признак из списка срочных — не ждите записи.'],
  watch: ['Можно наблюдать', 'Отметьте в пятом домене и следите. Если появится любой признак из списка срочных — сразу к врачу.'],
};

/** Какой режим дня предложить. Названия режимов — из js/modes.js.
 *  Потолок C и хуже — «После болезни»: спецификация велит лечить, а не гулять больше. */
export function suggestMode({ healthGrade = 'A', minutes, weekend }) {
  if ('CDE'.includes(healthGrade)) return { mode: 'recovery', why: 'Потолок по здоровью — нагрузку не наращиваем' };
  // Порог — минуты участия самого режима (js/modes.js), считаются из пунктов:
  // режим не должен требовать больше, чем у человека есть.
  const [we, home, busy] = ['weekend', 'home', 'busy'].map(id => modeMinutes(findMode('dog', id)));
  if (minutes != null && minutes >= we) return { mode: 'weekend', why: `Есть ${we} минут и больше` };
  if (minutes != null && minutes >= home) return { mode: 'home', why: `От ${home} минут` };
  if (minutes != null && minutes >= busy) return { mode: 'busy', why: `Меньше ${home} минут` };
  if (minutes != null) return { mode: 'busy', partial: true, why: `Даже «Сегодня завал» требует ${busy} минут — сделайте пункты, которые успеете` };
  return { mode: weekend ? 'weekend' : 'home', why: weekend ? 'Выходной' : 'Будний день' };
}
