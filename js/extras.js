// П8: остальные экраны уровня B — kb, kbdomains, status, course, support,
// referral, paywall, notracker и демонстрационные партнёрские экраны
// (insurance, partner, review, recs, events). Эталон — design/maket-pet-id-v15.html.
//
// Решения пользователя 27.09.2026: пейволл — «фейковая дверь» (пишет интерес,
// денег не берёт и говорит об этом); партнёры — демо с подписью.
// Правило контента: в базе знаний только то, у чего есть источник.
import * as db from './db.js';
import { humanError } from './db.js';
import { RED_FLAGS, SRC } from './triage.js';

const $ = s => document.querySelector(s);
const el = (t, c, txt) => { const n = document.createElement(t); if (c) n.className = c; if (txt != null) n.textContent = txt; return n; };
const title = t => { $('#title').textContent = t; };
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

let ui = null;
const S = { profile: null, pet: null, role: null };
export function init(api) { ui = api; }
const link = (text, url) => { const a = el('a', null, text); a.href = url; a.target = '_blank'; a.rel = 'noopener'; return a; };
const card = (...kids) => { const c = el('div', 'card'); c.append(...kids); return c; };
const entry = (ic, t, s, fn) => { const r = el('button', 'entry'); r.append(el('span', 'ic', ic)); const x = el('span'); x.append(el('b', null, t), el('em', null, s)); r.append(x, el('span', 'chev', '›')); r.onclick = fn; return r; };
function demoBanner(box) {
  const b = el('div', 'attn'); b.append(el('div', 'attn-h')); b.firstChild.append(el('span', null, 'Демонстрация'));
  b.append(el('p', null, 'Партнёров у веб-макета нет. Названия, цены и отзывы на этом экране вымышлены и одинаковы для всех; кнопки записи и оформления не работают.'));
  box.append(b);
}

/* ── база знаний ───────────────────────────────────────── */

const MELLOR = { name: 'Mellor D.J. et al. The 2020 Five Domains Model. Animals 2020, 10(10), 1870', url: 'https://www.mdpi.com/2076-2615/10/10/1870' };

export function openKb() {
  ui.show('v-kb'); title('База знаний');
  const box = $('#kb-body'); box.replaceChildren();
  box.append(el('p', 'lede', 'Только материалы с источником. Разделы, для которых проверенных текстов пока нет, помечены — лучше пустой раздел, чем выдуманный совет.'));
  box.append(el('div', 'sec', 'Основа методики'));
  box.append(entry('◎', 'Пять доменов благополучия', 'Как устроена оценка и почему пятый домен главный', openKbDomains));
  box.append(entry('4', 'Четыре правила расчёта', 'Её день, а не ваши дела; потолок; разное важнее, чем много; 80 — хорошая жизнь', () => ui.go('v-how')));
  box.append(el('div', 'sec', 'Здоровье'));
  box.append(entry('🚨', 'Когда к врачу срочно', '13 состояний AVMA и дополнения Merck', openUrgent));
  box.append(el('div', 'sec', 'Разделы в работе'));
  const c = el('div', 'card');
  for (const [ic, t] of [['🥩', 'Питание'], ['🏠', 'Среда'], ['🐾', 'Поведение'], ['📄', 'Документы и право']]) {
    const r = el('div', 'hrow static'); const m = el('div'); m.append(el('b', null, t), el('span', null, 'Статей пока нет: появятся вместе с источниками'));
    r.append(el('span', 'hic', ic), m); c.append(r);
  }
  box.append(c);
}

function openKbDomains() {
  ui.show('v-kbdomains'); title('Пять доменов');
  const box = $('#kbdomains-body'); box.replaceChildren();
  box.append(el('p', 'lede', 'Модель предложил Дэвид Меллор в 1994 году; редакции 2015 и 2020 годов добавили положительные состояния и взаимодействие с человеком.'));
  const D = [
    ['🍽️', 'Домен 1 · Питание', 'Еда и вода. В нашей модели ставит потолок, а не добавляет баллы: сытая собака не становится вдвое счастливее от второй миски.'],
    ['🏡', 'Домен 2 · Среда', 'Покой, тепло, своё место. Тоже ограничитель.'],
    ['🩺', 'Домен 3 · Здоровье', 'Боль, болезнь, профилактика. Просроченная обработка или прививка ставит потолок B.'],
    ['🐕', 'Домен 4 · Поведение и взаимодействия', 'Выбор, работа носом, общение, движение, новизна. С редакции 2020 года сюда входит и человек. Только этот домен набирает баллы.'],
    ['🧠', 'Домен 5 · Психическое состояние', 'Результат первых четырёх: то, как животному на самом деле живётся. Его и показывает крупная цифра.'],
  ];
  const c = el('div', 'card');
  for (const [ic, t, s] of D) { const r = el('div', 'hrow static'); const m = el('div'); m.append(el('b', null, t), el('span', null, s)); r.append(el('span', 'hic', ic), m); c.append(r); }
  box.append(c);
  box.append(card(el('b', 'ct', 'Два принципа, которые меняют практику'),
    el('p', 'hint', 'Первый. Отсутствие страдания — ещё не благополучие: нужны положительные переживания.'),
    el('p', 'hint', 'Второй. Благополучие живёт в голове животного: еда, дом и здоровье важны настолько, насколько создают переживание.')));
  const s = el('p', 'src-line'); s.append('Источник: ', link(MELLOR.name, MELLOR.url), '. Веса каналов и нормы в минутах — калибровка команды, не часть модели Меллора.');
  box.append(s);
}

export function openUrgent() {
  ui.show('v-kbdomains'); title('Когда к врачу срочно');
  const box = $('#kbdomains-body'); box.replaceChildren();
  box.append(el('p', 'lede', 'Если есть хоть что-то из списка — не ждите записи, везите в круглосуточную клинику.'));
  const ul = el('ul', 'reasons'); for (const r of RED_FLAGS) ul.append(el('li', null, r.text)); box.append(card(ul));
  const s = el('p', 'src-line'); s.append('Источники: ', link(SRC.AVMA.name, SRC.AVMA.url), ' · ', link(SRC.MVM.name, SRC.MVM.url), '.'); box.append(s);
}

/* ── статусы ───────────────────────────────────────────── */

export async function openStatus(pet, role) {
  if (pet) { S.pet = pet; S.role = role; }
  ui.show('v-status'); title(`Статусы · ${S.pet.name}`);
  const box = $('#status-body'); box.replaceChildren(el('div', 'load', 'Загрузка…'));
  try {
    const T = iso(new Date());
    const [st, ev] = await Promise.all([db.petStatus(S.pet.id), db.calendarEvents([S.pet.id], T, T).catch(() => [])]);
    const heat = ev.find(e => e.kind === 'heat' && e.starts_on <= T && (e.ends_on || e.starts_on) >= T);
    const manage = ['owner', 'co_owner'].includes(S.role);
    box.replaceChildren();
    box.append(el('p', 'lede', 'Публичный статус — предупреждение для окружающих, а не отслеживание: на карте видна зона и сам статус, без вашего имени и точной точки.'));
    const c = el('div', 'card');
    const row = (ic, t, s, on, fn, dis) => {
      const r = el('div', 'hrow static'); const m = el('div'); m.append(el('b', null, `${ic} ${t}`), el('span', null, s));
      const b = el('button', 'act' + (on ? ' on' : ''), on ? 'Включён' : 'Выключен'); b.disabled = !!dis; if (fn) b.onclick = fn;
      r.append(m, b); c.append(r);
    };
    const set = async patch => { try { await db.setPetStatus(S.pet.id, { friendly: st.friendly, aggressive: st.aggressive, ...patch }); await openStatus(); } catch (err) { ui.say('#status-msg', humanError(err)); } };
    row('🙂', 'Дружелюбен', 'Открыт к знакомствам, спокоен к чужим собакам', st.friendly, () => set({ friendly: !st.friendly, aggressive: false }), !manage);
    row('⚠️', 'Зооагрессия', 'Предупредить владельцев рядом: подходить не нужно', st.aggressive, () => set({ aggressive: !st.aggressive, friendly: false }), !manage);
    if (S.pet.species === 'dog' && S.pet.sex === 'f') row('🌸', 'Течка', heat ? `Из календаря: ${heat.starts_on.slice(8)}.${heat.starts_on.slice(5, 7)}–${(heat.ends_on || heat.starts_on).slice(8)}.${(heat.ends_on || heat.starts_on).slice(5, 7)}` : 'Берётся из календаря автоматически', !!heat, null, true);
    box.append(c);
    box.append(entry('🦸', 'Готов быть героем', 'Объявления о пропажах рядом — в «Команде Героев»', () => ui.go('heroes')));
    box.append(el('p', 'hint', 'Карта «Рядом» в веб-версии демонстрационная, поэтому сейчас статусы видят только участники ухода. Статус меняет владелец или совладелец.'));
  } catch (err) { box.replaceChildren(); ui.say('#status-msg', humanError(err)); }
}

/* ── курс ──────────────────────────────────────────────── */

// Уроки — о том, как пользоваться Pet ID, без ветеринарных советов от себя.
const LESSONS = [
  ['d5_intro', 'Пять доменов за три минуты', 'Четыре правила, из которых складывается крупная цифра.', 'v-how'],
  ['first_mark', 'Первая отметка дня', 'Отметьте хоть один канал: не отмечено — значит «не знаем», а не «не было».', 'day'],
  ['ceiling', 'Потолок: здоровье, еда, среда, страх', 'Почему лишняя прогулка не лечит хромоту и как ставится степень A–E.', 'day'],
  ['modes', 'Режим дня', 'Выполнимый план вместо идеального: завал, из дома, выходной.', 'day'],
  ['walk', 'Прогулка и приватная зона', 'Трек пишется при включённом экране; 150 м вокруг дома не сохраняются.', 'walks'],
  ['health', 'Карта здоровья и документы', 'Прививки и обработки со сроками; просрочка ставит потолок B.', 'health'],
  ['tag', 'Жетон и страница находки', 'QR, послание нашедшему и что он видит — и чего не видит.', 'qr'],
  ['urgent', 'Когда к врачу срочно', '13 состояний AVMA — чтобы не гадать в плохой момент.', 'urgent'],
];

export async function openCourse() {
  ui.show('v-course'); title('Курс новичка');
  const box = $('#course-body'); box.replaceChildren(el('div', 'load', 'Загрузка…'));
  try {
    const done = new Set((await db.courseDone()).map(x => x.lesson_id));
    const n = LESSONS.filter(l => done.has(l[0])).length;
    box.replaceChildren();
    const h = el('div', 'card');
    h.append(el('b', 'ct', `Пройдено ${n} из ${LESSONS.length}`));
    const bar = el('div', 'meter'); const i = el('i'); i.style.width = Math.round(n / LESSONS.length * 100) + '%'; bar.append(i); h.append(bar);
    h.append(el('p', 'hint', 'Курс о том, как пользоваться Pet ID. Ветеринарных советов в нём нет — только ссылки на источники.'));
    box.append(h);
    const c = el('div', 'card');
    LESSONS.forEach(([id, t, s, go], k) => {
      const r = el('div', 'hrow static lesson');
      const m = el('div'); m.append(el('b', null, `${k + 1}. ${t}`), el('span', null, s));
      const open = el('button', 'act', 'Открыть'); open.onclick = () => ui.go(go);
      const mark = el('button', 'act' + (done.has(id) ? ' on' : ''), done.has(id) ? '✓' : 'Пройдено');
      mark.disabled = done.has(id);
      mark.onclick = async () => { try { await db.markLesson(id); await openCourse(); } catch (err) { ui.say('#course-msg', humanError(err)); } };
      r.append(el('span', 'hic', done.has(id) ? '✓' : String(k + 1)), m, open, mark);
      c.append(r);
    });
    box.append(c);
  } catch (err) { box.replaceChildren(); ui.say('#course-msg', humanError(err)); }
}

/* ── поддержка ─────────────────────────────────────────── */

const TOPICS = { tag: 'Жетон', account: 'Аккаунт', data: 'Мои данные', bug: 'Ошибка', other: 'Другое' };
const FAQ = [
  ['🏷️ Жетон не открывается', 'Проверьте, что жетон включён (Питомец → Жетон). Если QR потерян или ссылка попала не к тем людям — «Выпустить новую ссылку»: старый QR сразу перестаёт работать.'],
  ['🔑 Забыл пароль', 'Восстановить нельзя: вход без почты, это цена решения, о ней предупреждает экран регистрации. Заведите новый логин и попросите владельца пригласить вас заново.'],
  ['👥 Передать питомца другому человеку', 'Пригласите его совладельцем (Питомец → Кто ухаживает). Полной смены владельца в макете нет.'],
  ['🗑️ Удалить аккаунт и данные', 'Самостоятельного удаления в макете нет. Напишите обращение с темой «Мои данные» — удаление делает команда вручную.'],
];

export async function openSupport() {
  ui.show('v-support'); title('Поддержка');
  const box = $('#support-body'); box.replaceChildren();
  box.append(el('p', 'lede', 'Обращения читает команда макета. Ответа внутри приложения пока нет — дежурной службы тоже нет.'));
  box.append(el('div', 'sec', 'Частые вопросы'));
  for (const [q, a] of FAQ) { const d = el('details', 'faq'); d.append(el('summary', null, q), el('p', 'hint', a)); box.append(d); }
  box.append(el('div', 'sec', 'Написать'));
  const c = el('div', 'card');
  let topic = 'bug';
  const ch = el('div', 'chips'); const renderCh = () => { ch.replaceChildren(); for (const [k, t] of Object.entries(TOPICS)) { const b = el('button', 'chip' + (k === topic ? '' : ' ghost'), t); b.onclick = () => { topic = k; renderCh(); }; ch.append(b); } }; renderCh();
  const ta = el('textarea'); ta.id = 'sp-body'; ta.rows = 4; ta.maxLength = 2000; ta.placeholder = 'Что случилось и на каком экране';
  const s = el('button', 'btn sm', 'Отправить'); s.id = 'sp-send';
  s.onclick = async () => {
    if (ta.value.trim().length < 5) return ui.say('#support-msg', 'Опишите проблему хотя бы парой слов');
    s.disabled = true;
    try { await db.support(topic, ta.value.trim()); await openSupport(); ui.say('#support-ok', 'Обращение записано', 'ok'); } catch (err) { s.disabled = false; ui.say('#support-msg', humanError(err)); }
  };
  c.append(ch, ta, s); box.append(c);
  try {
    const mine = await db.mySupport();
    if (mine.length) {
      box.append(el('div', 'sec', 'Ваши обращения'));
      const lc = el('div', 'card');
      for (const x of mine) { const r = el('div', 'hrow static'); const m = el('div'); m.append(el('b', null, TOPICS[x.topic]), el('span', null, `${new Date(x.created_at).toLocaleString('ru-RU')} · ${x.body}`)); r.append(m); lc.append(r); }
      box.append(lc);
    }
  } catch (_) { /* 008 не выполнен — без списка */ }
}

/* ── приглашения ───────────────────────────────────────── */

export async function openReferral(profile) {
  if (profile) S.profile = profile;
  ui.show('v-referral'); title('Пригласить друга');
  const box = $('#referral-body'); box.replaceChildren(el('div', 'load', 'Загрузка…'));
  try {
    const [list, inv] = await Promise.all([db.myReferrals(), db.myInviter()]);
    box.replaceChildren();
    const code = (S.profile && S.profile.login || '').toUpperCase();
    const url = new URL('index.html?ref=' + encodeURIComponent(code.toLowerCase()), location.href.replace(/[?#].*$/, '')).href;
    const c = el('div', 'card qrcard');
    c.append(el('p', 'hint', 'Ваш код'), el('b', 'refcode', code), el('a', 'qrlink', url));
    c.lastChild.href = url;
    const row = el('div', 'row');
    const sh = el('button', 'btn sm', 'Поделиться');
    sh.onclick = async () => { try { if (navigator.share) await navigator.share({ title: 'Pet ID', text: `Мой код в Pet ID: ${code}`, url }); else { await navigator.clipboard.writeText(url); sh.textContent = 'Ссылка скопирована'; } } catch (_) { /* отменили */ } };
    const cp = el('button', 'btn ghost sm', 'Скопировать код');
    cp.onclick = async () => { try { await navigator.clipboard.writeText(code); cp.textContent = 'Скопировано'; } catch (_) { cp.textContent = code; } };
    row.append(sh, cp); c.append(row); box.append(c);
    box.append(card(el('b', 'ct', 'Что получаете'),
      el('p', 'hint', 'В макете — месяц Premium вам и другу, когда друг пройдёт первую неделю. Premium и оплаты пока нет, поэтому месяцы только считаются: начислятся, когда появится оплата.'),
      el('p', 'hint', '«Первая неделя пройдена» — отметки в 4 из первых 7 дней. Порог — наше решение, не данные. Платим за то, что человек начал пользоваться, а не за регистрацию.')));
    box.append(el('div', 'sec', `Приглашённые · ${list.length}`));
    const lc = el('div', 'card');
    if (!list.length) lc.append(el('p', 'hint', 'Пока никого.'));
    for (const x of list) {
      const done = x.active_days >= 4;
      const r = el('div', 'hrow static'); const m = el('div');
      m.append(el('b', null, `@${x.login}`), el('span', null, `с ${new Date(x.claimed_at).toLocaleDateString('ru-RU')} · отметки в ${x.active_days} из 7 дней${x.week_over ? ' · неделя прошла' : ''}`));
      r.append(el('span', 'hic', done ? '✓' : '⏳'), m, el('b', 'badge', done ? 'засчитано' : `${x.active_days}/4`));
      lc.append(r);
    }
    box.append(lc);
    const credited = list.filter(x => x.active_days >= 4).length;
    box.append(el('p', 'hint', `Накоплено: ${credited} ${credited === 1 ? 'месяц' : credited > 1 && credited < 5 ? 'месяца' : 'месяцев'} Premium — начислятся, когда появится оплата.`));
    if (!inv) {
      box.append(el('div', 'sec', 'У меня есть код'));
      const ic = el('input'); ic.id = 'ref-code'; ic.placeholder = 'Код друга'; ic.autocapitalize = 'characters';
      const go = el('button', 'btn sm', 'Ввести');
      go.onclick = async () => { try { const who = await db.claimReferral(ic.value.trim()); await openReferral(); ui.say('#referral-ok', `Код @${who} принят`, 'ok'); } catch (err) { ui.say('#referral-msg', humanError(err)); } };
      box.append(card(ic, go, el('p', 'hint', 'Код вводят один раз, в первые 14 дней после регистрации.')));
    } else box.append(el('p', 'hint', 'Вы пришли по приглашению — код уже введён.'));
  } catch (err) { box.replaceChildren(); ui.say('#referral-msg', humanError(err)); }
}

/* ── пейволл: фейковая дверь ───────────────────────────── */

export function openPaywall() {
  ui.show('v-paywall'); title('Premium');
  db.interest('paywall_view');
  const box = $('#paywall-body'); box.replaceChildren();
  let plan = 'month';
  const hero = el('div', 'hero');
  hero.append(el('h2', null, 'Быть хорошим хозяином — не значит быть идеальным'),
    el('p', null, 'Premium каждый вечер отвечает на единственный важный вопрос: сегодня было достаточно?'));
  box.append(hero);
  const c = el('div', 'card');
  for (const [ic, t, s] of [['◎', 'Дневник достаточности', 'Пять доменов, неделя, одно действие на завтра'], ['📋', 'Режимы дня', 'Выполнимый план под «завал», «из дома» и «выходной»'],
    ['💡', 'Разбор инцидентов', 'Погрыз диван, писает мимо лотка — что это значит'], ['🩺', 'Расширенная карта здоровья', 'История, документы, напоминания по каждому препарату']]) {
    const r = el('div', 'hrow static'); const m = el('div'); m.append(el('b', null, t), el('span', null, s)); r.append(el('span', 'hic', ic), m); c.append(r);
  }
  box.append(c);
  const tabs = el('div', 'tabs');
  const price = el('p', 'price');
  const renderPlan = () => {
    tabs.replaceChildren();
    for (const [k, t] of [['month', 'Месяц'], ['year', 'Год · −30%']]) { const b = el('button', plan === k ? 'on' : null, t); b.onclick = () => { plan = k; renderPlan(); }; tabs.append(b); }
    // Годовая цена — 299 × 12 × 0,7 = 2 511,6 → 2 512 ₽ (−30% из макета).
    price.textContent = plan === 'month' ? '299 ₽ в месяц' : '2 512 ₽ в год';
  };
  renderPlan();
  box.append(tabs, price, el('p', 'hint center', 'Второй питомец +100 ₽. Первые 7 дней бесплатно, отмена в один тап.'));
  const tr = el('button', 'btn', 'Попробовать 7 дней бесплатно'); tr.id = 'pw-try';
  tr.onclick = async () => {
    await db.interest('paywall_try', plan);
    box.replaceChildren();
    const h = el('div', 'hero'); h.append(el('div', 'hero-ic', '✓'), el('h2', null, 'Спасибо — интерес записан'),
      el('p', null, 'Оплаты в веб-макете нет, и денег мы не возьмём. Ваше нажатие помогает решить, запускать ли Premium и по какой цене. Всё, что есть в макете, сейчас бесплатно.'));
    box.append(h);
  };
  const later = el('button', 'linkbtn', 'Позже');
  later.onclick = async () => { await db.interest('paywall_later', plan); ui.go('pets'); };
  box.append(tr, later);
  box.append(card(el('b', 'ct', 'Всегда бесплатно'), el('p', 'hint', 'Профиль, календарь, карта, QR-жетон и страница находки. За возможность найти своё животное платить не нужно никогда.')));
}

/* ── без трекера ───────────────────────────────────────── */

export function openNotracker() {
  ui.show('v-notracker'); title('Без трекера');
  const box = $('#notracker-body'); box.replaceChildren();
  box.append(el('p', 'lede', 'Трекеров у веб-версии нет вообще: всё работает от телефона и ваших отметок. Вот что это значит на деле.'));
  const ok = [['◎', 'Пять доменов', 'По вашим отметкам и режимам дня'], ['🐾', 'Прогулка по GPS телефона', 'Пока экран включён; точки хуже 50 м отбрасываются'],
    ['🏷️', 'QR-жетон и страница находки', 'Бесплатно, работают без входа'], ['🩺', 'Карта здоровья и документы', 'Фото, сроки, напоминания в приложении'], ['₽', 'Расходы', 'Вручную, с фото чека']];
  const no = [['📡', 'Живая точка, когда питомец не с вами', 'Нужен ошейник с передатчиком'], ['🌙', 'Фоновая запись прогулки', 'Браузер не пишет геолокацию в фоне'],
    ['👋', '«Снюхаться» и «кто рядом» в реальном времени', 'Нужны живые пользователи и фоновая геолокация'], ['❤️', 'Пульс и сон', 'Нужен датчик']];
  for (const [lab, list] of [['Что работает', ok], ['Что недоступно', no]]) {
    box.append(el('div', 'sec', lab)); const c = el('div', 'card');
    for (const [ic, t, s] of list) { const r = el('div', 'hrow static'); const m = el('div'); m.append(el('b', null, t), el('span', null, s)); r.append(el('span', 'hic', ic), m); c.append(r); }
    box.append(c);
  }
  box.append(entry('📡', 'Как выглядело бы с трекером', 'Прототип на выдуманных данных', () => ui.go('tracker')));
}

/* ── демонстрационные партнёрские экраны ───────────────── */

export function openPartners() {
  ui.show('v-partners'); title('Партнёры · демо');
  const box = $('#partners-body'); box.replaceChildren();
  demoBanner(box);
  box.append(entry('🛡️', 'Страхование', 'Полис для питомца', () => demoInsurance()));
  box.append(entry('✂️', 'Груминг «Пушистый хвост»', 'Карточка партнёра и запись', () => demoPartner()));
  box.append(entry('♥', 'Как всё прошло', 'Двусторонний отзыв после визита', () => demoReview()));
  box.append(entry('📜', 'Банк рекомендаций', 'Именные тексты от клиник и передержек', () => demoRecs()));
  box.append(entry('📣', 'Лента событий', 'Акции и события партнёров', () => demoEvents()));
}
function demoScreen(t) { ui.show('v-demo'); title(t); const box = $('#demo-body'); box.replaceChildren(); demoBanner(box); return box; }
const kvCard = rows => { const c = el('div', 'card'); for (const [k, v] of rows) { const r = el('div', 'kv'); r.append(el('span', null, k), el('b', null, v)); c.append(r); } return c; };
const dead = t => { const b = el('button', 'btn', t); b.disabled = true; return b; };

function demoInsurance() {
  const box = demoScreen('Страхование');
  box.append(card(el('b', 'ct', 'Полис для питомца'), el('p', 'hint', 'Покрытие лечения при травмах и болезнях, включая хронические состояния после первого года действия полиса.')));
  box.append(kvCard([['Стоимость', '8 900 ₽ / год'], ['Покрытие', 'до 150 000 ₽'], ['Франшиза', '5 000 ₽ на случай'], ['Партнёр', 'страховая компания (вымышленная)']]));
  box.append(dead('Оформить полис'));
  box.append(el('p', 'hint', 'В продукте данные карты здоровья передавались бы страховщику с вашего согласия. В макете ничего никуда не передаётся.'));
}
function demoPartner() {
  const box = demoScreen('Груминг');
  box.append(kvCard([['Салон', '«Пушистый хвост»'], ['Адрес', 'вымышленный'], ['Отзывы', '♥ 88% · 124']]));
  box.append(card(el('b', 'ct', 'Свободные окна'), el('p', 'hint', 'Завтра, 11:00 · комплекс · 3 500 ₽'), el('p', 'hint', 'Завтра, 15:30 · комплекс · 3 500 ₽')));
  box.append(dead('Записаться на 11:00'));
  box.append(el('p', 'hint', 'В продукте мастер получал бы породу, вес, особенности и аллергии питомца — только по записи и с вашего согласия.'));
}
function demoReview() {
  const box = demoScreen('Как всё прошло');
  box.append(card(el('p', 'hint', 'Отзыв мастера о питомце · ♥ +1'), el('p', 'lead', '«Спокойный, терпит фен, не дёргается. Хозяйка предупредила про грозу — включили тихую музыку.»'), el('p', 'hint', 'Ирина, мастер (вымышленная)')));
  box.append(card(el('b', 'ct', 'Почему оценка двусторонняя'), el('p', 'hint', 'Партнёр рискует так же, как и владелец: агрессивное или больное животное — его проблема. Ваша оценка появится у салона после того, как вы её поставите.')));
  box.append(dead('Отправить отзыв'));
}
function demoRecs() {
  const box = demoScreen('Банк рекомендаций');
  box.append(el('p', 'lede', 'Не рейтинг и не звёзды: именные тексты от людей и организаций, которые реально имели с вами дело. Каждая привязана к событию в календаре — «просто так» не написать.'));
  box.append(card(el('p', 'hint', '🏥 «Свой доктор» (вымышленная клиника) · после приёма'), el('p', 'lead', '«Владелец приходит подготовленным, приносит выписки и список вопросов. Питомец спокоен на осмотре.»')));
  box.append(dead('Запросить рекомендацию'));
}
function demoEvents() {
  const box = demoScreen('Лента событий');
  for (const [ic, t, s] of [['✂️', '«Пушистый хвост»: комплекс −20%', 'Всю неделю, для подписчиков ленты'], ['🏥', 'День бесплатной диспансеризации', 'Сеть «Свой доктор»'], ['🎪', 'Выставка собак «Осень»', 'Площадка агрегирована']]) {
    box.append(card(el('b', 'ct', `${ic} ${t}`), el('p', 'hint', s), dead('+ В мой календарь')));
  }
  box.append(el('p', 'hint', 'Кнопка «в календарь» отключена намеренно: вымышленное событие в вашем настоящем календаре — хуже, чем его отсутствие. Свои события добавляйте в календаре питомца.'));
}

export function back(view) {
  if (view === 'v-kbdomains') { openKb(); return true; }
  if (view === 'v-demo') { openPartners(); return true; }
  return false;
}
