// Демо-режим (экран demo из макета): приложение заполнено вымышленным примером,
// ничего не сохраняется и никуда не отправляется. Это подмена supabase-js тем же
// API, который зовёт db.js, поверх данных в памяти вкладки. Открывается по
// адресу index.html?demo; перезагрузка — всё сначала.

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const at = (n, h, m = 0) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(h, m, 0, 0); return d.toISOString(); };
let seq = 1000;
const uid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

const ME = '00000000-0000-4000-8000-000000000001', OLGA = '00000000-0000-4000-8000-000000000002';
const REX = '00000000-0000-4000-8000-0000000000a1', MUSYA = '00000000-0000-4000-8000-0000000000a2';

function seed() {
  const DB = {
    profiles: [{ id: ME, login: 'demo', display_name: 'Вы (демо)', city: 'Москва', district: 'Динамо' }],
    pets: [
      { id: REX, name: 'Рекс', species: 'dog', breed: 'бордер-колли', sex: 'm', birth_date: day(-880), owner_id: ME, created_at: at(-200, 10) },
      { id: MUSYA, name: 'Муся', species: 'cat', breed: null, sex: 'f', birth_date: day(-1500), owner_id: ME, created_at: at(-200, 11) },
    ],
    pet_members: [{ pet_id: REX, user_id: ME, role: 'owner' }, { pet_id: MUSYA, user_id: ME, role: 'owner' }],
    domain_entries: [], gate_marks: [], day_modes: [], walks: [], walk_points: [], health_records: [], documents: [],
    document_pages: [], calendar_events: [], reminder_rules: [], expenses: [], pet_tags: [], found_reports: [],
    posts: [], post_likes: [], follows: [], questions: [], answers: [], expert_optin: [], lost_alerts: [], hero_responses: [],
    hero_settings: [], pet_statuses: [], interest_events: [], referrals: [], support_requests: [], course_progress: [], content_reports: [],
    custom_modes: [], pet_photos: [], diets: [], food_exclusions: [],
  };
  const E = (pet, d, channel, value, extra = {}) => DB.domain_entries.push({ id: uid(), pet_id: pet, day: day(d), channel, value, source: 'manual', plan_item: null, walk_id: null, created_by: ME, created_at: at(d, 19), ...extra });
  // Две недели Рекса: разные дни, в середине — хромота, степень C.
  const rex = [[-13, 25, 20, 40, 55], [-12, 30, 20, 45, 60], [-11, 20, 15, 30, 50], [-10, 30, 25, 45, 70], [-9, 15, 10, 20, 40], [-8, 30, 20, 40, 60], [-7, 25, 20, 45, 55],
    [-6, 14, 22, 30, 22], [-5, 30, 20, 45, 60], [-4, 14, 22, 30, 22], [-3, 20, 15, 30, 45], [-2, 25, 20, 40, 50], [-1, 30, 20, 45, 60], [0, 10, null, null, 30]];
  for (const [d, choice, nose, social, move] of rex) {
    E(REX, d, 'choice', choice); if (nose != null) E(REX, d, 'nose', nose); if (social != null) E(REX, d, 'social', social); E(REX, d, 'move', move);
  }
  for (const d of [-12, -9, -5, -2]) E(REX, d, 'novel', 1);
  DB.gate_marks.push({ id: uid(), pet_id: REX, day: day(-4), gate: 'health', grade: 'C', created_by: ME, created_at: at(-4, 9) });
  DB.gate_marks.push({ id: uid(), pet_id: REX, day: day(-3), gate: 'health', grade: 'A', created_by: ME, created_at: at(-3, 9) });
  for (const d of [-6, -4, -2, -1]) { E(MUSYA, d, 'hunt', 20); E(MUSYA, d, 'choice', 60); E(MUSYA, d, 'terr', 30); E(MUSYA, d, 'social', 15); }

  // Прогулка с треком у парка — без приватной зоны вокруг «дома».
  const w = uid();
  DB.walks.push({ id: w, pet_id: REX, day: day(-1), started_at: at(-1, 8), ended_at: at(-1, 8, 42), duration_min: 42, distance_m: 2380, source: 'track', track_broken: false, note: null, created_by: ME, created_at: at(-1, 8, 45) });
  for (let i = 0; i < 40; i++) DB.walk_points.push({ id: i + 1, walk_id: w, t: at(-1, 8, 3 + i), lat: 55.7920 + Math.sin(i / 6) * 0.004, lon: 37.5540 + i * 0.00025, acc_m: 8 });
  DB.walks.push({ id: uid(), pet_id: REX, day: day(-2), started_at: null, ended_at: null, duration_min: 30, distance_m: null, source: 'manual', track_broken: false, note: 'Вечером у дома', created_by: ME, created_at: at(-2, 21) });

  const H = (o) => DB.health_records.push({ id: uid(), pet_id: REX, product: null, valid_until: null, repeat_days: null, clinic: null, weight_kg: null, note: null, source: 'manual', document_id: null, created_by: ME, created_at: at(-100, 12), ...o });
  H({ kind: 'vaccine', title: 'Бешенство', product: 'Нобивак Rabies', done_on: day(-170), valid_until: day(900), clinic: 'Свой доктор' });
  H({ kind: 'vaccine', title: 'Комплексная', product: 'Нобивак DHPPi', done_on: day(-350), valid_until: day(17), clinic: 'Свой доктор' });
  H({ kind: 'parasite', title: 'От клещей', product: 'Бравекто', done_on: day(-90), repeat_days: 84 });
  H({ kind: 'parasite', title: 'Антигельминтик', product: 'Мильбемакс', done_on: day(-45), repeat_days: 90 });
  H({ kind: 'care', title: 'Стрижка когтей', done_on: day(-20), repeat_days: 21 });
  H({ kind: 'visit', title: 'Плановый осмотр', done_on: day(-170), clinic: 'Свой доктор', weight_kg: 20.4 });
  H({ kind: 'visit', title: 'Хромота задней правой', done_on: day(-4), clinic: 'Свой доктор', note: 'Растяжение, покой 3 дня' });

  DB.calendar_events.push({ id: uid(), pet_id: REX, kind: 'other', title: 'Груминг, 11:00', starts_on: day(5), ends_on: null, at_time: '11:00', note: null, created_by: ME, created_at: at(-3, 10) });
  DB.calendar_events.push({ id: uid(), pet_id: MUSYA, kind: 'food', title: 'Заказать корм', starts_on: day(3), ends_on: null, at_time: null, note: null, created_by: ME, created_at: at(-3, 10) });

  const X = (d, category, amount, note) => DB.expenses.push({ id: uid(), pet_id: REX, spent_on: day(d), category, amount_rub: amount, note: note || null, document_id: null, created_by: ME, created_at: at(d, 12) });
  for (const m of [0, 1, 2, 3]) { X(-2 - m * 30, 'food', 3940, 'Корм 11,4 кг'); X(-10 - m * 30, 'treats', 450 + m * 50); }
  X(-4, 'vet', 1180, 'Приём + анализы'); X(-60, 'grooming', 1500); X(-90, 'prevention', 980, 'Бравекто');

  DB.pet_tags.push({ pet_id: REX, token: 'd3m0d3m0d3m0', message: 'Меня зовут Рекс. Я не потерялся, я потерял хозяина. Нажмите кнопку — и я поеду домой.', notes: 'Боится грозы.', active: true, updated_by: ME, updated_at: at(-30, 10) });
  DB.pet_statuses.push({ pet_id: REX, friendly: true, aggressive: false, updated_by: ME, updated_at: at(-30, 10) });

  DB.posts.push({ id: uid(), author_id: OLGA, author_login: 'olga', pet_id: null, pet_name: 'Муся', body: 'Первая неделя с шлейкой. Оказывается, она каждый вечер ходит к соседнему дому в одно и то же время.', hidden: false, created_at: at(0, 6) });
  DB.posts.push({ id: uid(), author_id: ME, author_login: 'demo', pet_id: REX, pet_name: 'Рекс', body: 'Сорок минут в парке, половину времени Рекс сам выбирал, куда идти.', hidden: false, created_at: at(-1, 9) });
  DB.questions.push({ id: uid(), author_id: OLGA, author_login: 'olga', breed: 'бордер-колли', city: null, scope: 'country', title: 'Нормально ли столько линять весной?', body: null, hidden: false, created_at: at(-2, 12) });
  DB.lost_alerts.push({ id: uid(), pet_id: uid(), author_id: OLGA, pet_name: 'Барсик', species: 'cat', description: 'Рыжий кот, без ошейника, боится людей.', lat: 55.7930, lon: 37.5600, hidden: false, resolved_at: null, created_at: at(0, 5) });
  // П11: рацион, исключение, свой режим у кошки, фото (картинки — нарисованные заглушки).
  DB.diets.push({ id: uid(), pet_id: REX, started_on: day(-40), food: 'Сухой корм, ягнёнок', kind: 'dry', grams_per_day: 320, meals_per_day: 2, kcal_per_day: null, pack_kg: 12, pack_opened_on: day(-30), note: null, created_by: ME, created_at: at(-40, 9) });
  DB.food_exclusions.push({ id: uid(), pet_id: REX, item: 'курица', reason: 'allergy', confirmed: 'ветклиника «Свой доктор»', noted_on: day(-330), created_by: ME });
  DB.custom_modes.push({ id: uid(), pet_id: MUSYA, code: 'c_d3m0d3m0aa', name: 'Вечер с удочкой', icon: '🎣', weekdays: [1, 3, 5],
    items: [{ id: 'hunt', at: '20:00', text: 'Удочка: три подхода по пять минут', min: 15, ch: { hunt: 15, social: 5 } }, { id: 'shelf', text: 'Полка у окна открыта весь день', min: 0, ch: { terr: 30, choice: 60 } }],
    created_by: ME, created_at: at(-20, 9), updated_at: at(-20, 9) });
  for (const [d, tag, cap, em] of [[-1, 'walk', 'Парк, первый снег', '🌳'], [-6, 'care', 'После груминга', '✂️'], [-12, 'walk', 'Новое место — набережная', '🌊'], [-40, 'health', 'Повязка после растяжения', '🩹']]) {
    const path = `${REX}/photos/demo${d}.jpg`;
    FILES.set(path, 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="100%" height="100%" fill="#dbedea"/><text x="50%" y="46%" text-anchor="middle" font-size="160">${em}</text><text x="50%" y="75%" text-anchor="middle" font-family="sans-serif" font-size="30" fill="#3d4b52">демо-снимок</text></svg>`));
    DB.pet_photos.push({ id: uid(), pet_id: REX, path, taken_on: day(d), tag, caption: cap, created_by: ME, created_at: at(d, 18) });
  }
  return DB;
}

const FILES = new Map();
const DB = seed();

// Простое сопоставление имён колонок из select для встроенных связей (documents → document_pages).
class Q {
  constructor(t) { this.t = t; this.f = []; this.op = 'select'; this.ord = []; this.lim = null; this.cols = '*'; }
  select(cols) { if (this.op === 'select') this.cols = cols || '*'; this.ret = true; return this; }
  eq(k, v) { this.f.push(r => r[k] === v); return this; }
  neq(k, v) { this.f.push(r => r[k] !== v); return this; }
  gte(k, v) { this.f.push(r => r[k] >= v); return this; }
  lte(k, v) { this.f.push(r => r[k] <= v); return this; }
  in(k, v) { this.f.push(r => v.includes(r[k])); return this; }
  is(k, v) { this.f.push(r => (r[k] ?? null) === v); return this; }
  like(k, v) { const re = new RegExp('^' + v.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/%/g, '.*') + '$'); this.f.push(r => re.test(r[k] || '')); return this; }
  order(k, o) { this.ord.push([k, o && o.ascending === false ? -1 : 1]); return this; }
  limit(n) { this.lim = n; return this; }
  insert(rows) { this.op = 'insert'; this.rows = [].concat(rows); return this; }
  upsert(rows) { this.op = 'upsert'; this.rows = [].concat(rows); return this; }
  update(p) { this.op = 'update'; this.patch = p; return this; }
  delete() { this.op = 'delete'; return this; }
  maybeSingle() { this.one = 'maybe'; return this; }
  single() { this.one = 'single'; return this; }
  _keys() { return { reminder_rules: ['pet_id', 'kind'], pet_statuses: ['pet_id'], expert_optin: ['user_id'], hero_settings: ['user_id'], course_progress: ['user_id', 'lesson_id'], pet_tags: ['pet_id'] }[this.t] || ['id']; }
  run() {
    const T = DB[this.t] = DB[this.t] || [];
    const now = new Date().toISOString();
    if (this.op === 'insert' || this.op === 'upsert') {
      const out = [];
      for (const r0 of this.rows) {
        const r = { id: uid(), created_at: now, created_by: ME, ...r0 };
        if (this.t === 'posts') Object.assign(r, { author_id: ME, author_login: 'demo', hidden: false, pet_name: r.pet_id ? (DB.pets.find(p => p.id === r.pet_id) || {}).name || null : null });
        if (this.t === 'questions') Object.assign(r, { author_id: ME, author_login: 'demo', hidden: false });
        if (this.t === 'lost_alerts') { const p = DB.pets.find(x => x.id === r.pet_id); Object.assign(r, { author_id: ME, pet_name: p ? p.name : '?', species: p ? p.species : 'dog', hidden: false, resolved_at: null }); }
        if (this.t === 'hero_responses') Object.assign(r, { user_id: ME, user_login: 'demo' });
        if (this.t === 'answers') Object.assign(r, { author_id: ME, author_login: 'demo' });
        if (this.op === 'upsert') {
          const k = this._keys(); const ex = T.find(x => k.every(c => x[c] === r[c]));
          if (ex) { Object.assign(ex, r0); out.push(ex); continue; }
        }
        T.push(r); out.push(r);
      }
      return this.fin(out);
    }
    let rows = T.filter(r => this.f.every(f => f(r)));
    if (this.op === 'delete') {
      for (const r of rows) T.splice(T.indexOf(r), 1);
      if (this.t === 'walks') for (const r of rows) { DB.domain_entries = DB.domain_entries.filter(e => e.walk_id !== r.id); DB.walk_points = DB.walk_points.filter(p => p.walk_id !== r.id); }
      if (this.t === 'pets') for (const r of rows) for (const k of Object.keys(DB)) if (Array.isArray(DB[k]) && k !== 'pets') DB[k] = DB[k].filter(x => x.pet_id !== r.id);
      return this.fin(rows);
    }
    if (this.op === 'update') { rows.forEach(r => Object.assign(r, this.patch)); return this.fin(rows); }
    for (const [k, o] of [...this.ord].reverse()) rows = [...rows].sort((a, b) => a[k] < b[k] ? -o : a[k] > b[k] ? o : 0);
    if (this.lim) rows = rows.slice(0, this.lim);
    rows = rows.map(r => ({ ...r }));
    if (this.t === 'documents' && /document_pages/.test(this.cols)) for (const r of rows) r.document_pages = DB.document_pages.filter(p => p.document_id === r.id);
    return this.fin(rows);
  }
  fin(rows) { if (this.one) return { data: rows[0] || null, error: null }; return { data: rows, error: null }; }
  then(res, rej) { return Promise.resolve(this.run()).then(res, rej); }
}

const RPC = {
  pet_members_view: ({ p_pet }) => DB.pet_members.filter(m => m.pet_id === p_pet).map(m => ({ user_id: m.user_id, login: 'demo', display_name: 'Вы (демо)', role: m.role })),
  invite_member: () => { throw new Error('В демо приглашать некого — заведите свой профиль'); },
  ensure_pet_tag: ({ p_pet }) => { let t = DB.pet_tags.find(x => x.pet_id === p_pet); if (!t) { t = { pet_id: p_pet, token: Math.random().toString(16).slice(2, 14).padEnd(12, '0'), message: null, notes: null, active: true }; DB.pet_tags.push(t); } return t.token; },
  public_pet_card: ({ p_token }) => { const t = DB.pet_tags.find(x => x.token === p_token && x.active); if (!t) return []; const p = DB.pets.find(x => x.id === t.pet_id); return [{ name: p.name, species: p.species, breed: p.breed, sex: p.sex, age_years: 2, message: t.message, notes: t.notes }]; },
  report_found: () => true,
  answer_counts: ({ p_ids }) => p_ids.map(id => ({ question_id: id, n: DB.answers.filter(a => a.question_id === id).length })),
  response_counts: ({ p_ids }) => p_ids.map(id => ({ alert_id: id, n: DB.hero_responses.filter(a => a.alert_id === id).length })),
  my_referrals: () => [],
  claim_referral: () => { throw new Error('В демо коды приглашений не работают'); },
};

const PLACEHOLDER = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="100%" height="100%" fill="#eceee9"/><text x="50%" y="50%" text-anchor="middle" font-family="sans-serif" font-size="28" fill="#69787d">Демо: файл не сохраняется</text></svg>');

export function createClient() {
  const session = { user: { id: ME } };
  return {
    auth: {
      getSession: async () => ({ data: { session } }), getUser: async () => ({ data: { user: session.user } }),
      signOut: async () => { location.href = location.pathname; return {}; },
      signInWithPassword: async () => ({ data: { session } }), signUp: async () => ({ data: { session } }),
    },
    from: t => new Q(t),
    rpc: async (name, args) => { try { const f = RPC[name]; if (!f) return { data: null, error: { message: 'В демо недоступно' } }; return { data: f(args || {}), error: null }; } catch (e) { return { data: null, error: { message: e.message } }; } },
    storage: { from: () => ({
      // Загруженное в демо живёт как blob-ссылка до перезагрузки вкладки.
      upload: async (path, f) => { try { FILES.set(path, URL.createObjectURL(f)); } catch (_) { /* не файл */ } return { data: {}, error: null }; },
      createSignedUrl: async path => ({ data: { signedUrl: FILES.get(path) || PLACEHOLDER }, error: null }),
      remove: async paths => { for (const p of paths || []) FILES.delete(p); return { data: [], error: null }; },
    }) },
  };
}
