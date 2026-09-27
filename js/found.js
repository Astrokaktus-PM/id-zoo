// Страница находки — found и found2 из макета. Открывается без входа по ссылке
// с жетона: found.html#<токен>. Данные — только через public_pet_card() и
// report_found() (sql/007): ни имени владельца, ни телефона, ни адреса.
import { publicCard, reportFound, humanError } from './db.js';

const $ = s => document.querySelector(s);
const el = (t, c, txt) => { const n = document.createElement(t); if (c) n.className = c; if (txt != null) n.textContent = txt; return n; };
const SPECIES = { dog: ['🐕', 'Собака'], cat: ['🐈', 'Кошка'] };
const SEX = { dog: { m: 'кобель', f: 'сука' }, cat: { m: 'кот', f: 'кошка' } };
const plural = (n, w) => { const a = n % 10, b = n % 100; return b > 4 && b < 21 ? w[2] : a === 1 ? w[0] : a > 1 && a < 5 ? w[1] : w[2]; };
const say = t => { const m = $('#f-msg'); m.textContent = t; m.classList.add('on'); };
const token = (location.hash || '').slice(1).trim().toLowerCase();

let card = null;

function renderCard() {
  const box = $('#f-body'); box.replaceChildren();
  const [ic, sp] = SPECIES[card.species] || ['🐾', 'Питомец'];
  $('#title').textContent = `Это ${card.name}`;
  document.title = `${card.name} — Pet ID`;
  const hero = el('div', 'hero');
  hero.append(el('div', 'hero-ic', ic), el('h2', null, card.name));
  if (card.message) hero.append(el('p', null, `«${card.message}»`));
  box.append(hero);

  const c = el('div', 'card');
  const kv = (k, v) => { if (!v) return; const r = el('div', 'kv'); r.append(el('span', null, k), el('b', null, v)); c.append(r); };
  kv('Кто', [sp, card.breed, card.sex && (SEX[card.species] || {})[card.sex]].filter(Boolean).join(', '));
  if (card.age_years != null) kv('Возраст', card.age_years < 1 ? 'меньше года' : `около ${card.age_years} ${plural(card.age_years, ['года', 'лет', 'лет'])}`);
  box.append(c);
  if (card.notes) {
    const n = el('div', 'attn'); n.append(el('div', 'attn-h')); n.firstChild.append(el('span', null, 'Важно знать'));
    n.append(el('p', null, card.notes)); box.append(n);
  }

  const go = el('button', 'btn', 'Я нашёл этого питомца');
  go.onclick = renderForm;
  box.append(go);
  box.append(el('p', 'hint', 'Владелец увидит ваше сообщение в приложении Pet ID. Его имя и телефон здесь не показываются, ваш контакт — только если вы сами его оставите.'));
}

function renderForm() {
  const box = $('#f-body'); box.replaceChildren();
  box.append(el('p', 'lede', `Сообщение для владельца ${card.name}. Все поля необязательны, но без контакта владелец не сможет с вами связаться.`));
  const c = el('div', 'card');
  const f = (lab, node, hint) => { const w = el('div', 'f'); const l = el('label', null, lab); l.htmlFor = node.id; w.append(l, node); if (hint) w.append(el('p', 'hint', hint)); return w; };
  const msg = el('textarea'); msg.id = 'fd-msg'; msg.rows = 3; msg.maxLength = 500; msg.placeholder = 'Где нашли, в каком состоянии, где ждёте';
  const contact = el('input'); contact.id = 'fd-contact'; contact.maxLength = 100; contact.placeholder = 'Телефон или ник в мессенджере';
  c.append(f('Сообщение', msg), f('Как с вами связаться', contact, 'Увидят только владелец и те, кто вместе с ним ухаживает за питомцем.'));
  const geo = el('label', 'check'); const cb = el('input'); cb.type = 'checkbox'; cb.id = 'fd-geo';
  geo.append(cb, el('span', null, 'Отправить мою геопозицию — браузер спросит разрешение'));
  c.append(geo);
  box.append(c);
  const send = el('button', 'btn', 'Отправить владельцу'); send.id = 'fd-send';
  send.onclick = async () => {
    send.disabled = true;
    let pos = null;
    if (cb.checked) {
      pos = await new Promise(ok => {
        if (!('geolocation' in navigator)) return ok(null);
        navigator.geolocation.getCurrentPosition(p => ok(p.coords), () => ok(null), { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
      });
      if (!pos) say('Геопозицию получить не удалось — отправляем без неё.');
    }
    try {
      await reportFound(token, { message: msg.value.trim(), contact: contact.value.trim(),
        lat: pos ? pos.latitude : null, lon: pos ? pos.longitude : null, acc: pos ? pos.accuracy : null });
      renderDone(!!pos, !!contact.value.trim());
    } catch (err) { send.disabled = false; say(humanError(err)); }
  };
  box.append(send);
  const back = el('button', 'linkbtn', 'Назад'); back.onclick = renderCard; box.append(back);
}

function renderDone(withGeo, withContact) {
  $('#title').textContent = 'Спасибо';
  const box = $('#f-body'); box.replaceChildren();
  const hero = el('div', 'hero');
  hero.append(el('div', 'hero-ic', '✓'), el('h2', null, 'Сообщение сохранено'));
  hero.append(el('p', null, `Владелец увидит его в приложении${withGeo ? ' вместе с вашей геопозицией' : ''}. ` +
    (withContact ? 'Он свяжется с вами по оставленному контакту.' : 'Контакт вы не оставили — если можете, подождите рядом.')));
  box.append(hero);
  if (card.notes) {
    const n = el('div', 'attn'); n.append(el('div', 'attn-h')); n.firstChild.append(el('span', null, 'Пока ждёте'));
    n.append(el('p', null, card.notes)); box.append(n);
  }
  box.append(el('p', 'hint', 'Мгновенного уведомления на телефон владельца в веб-версии нет: он увидит сообщение, когда откроет приложение.'));
}

(async function boot() {
  if (!/^[a-f0-9]{12}$/.test(token)) { $('#f-body').replaceChildren(); say('Ссылка неполная. Проверьте адрес на жетоне.'); return; }
  try {
    card = await publicCard(token);
    if (!card) { $('#f-body').replaceChildren(); say('Жетон не найден или отключён владельцем.'); return; }
    renderCard();
  } catch (err) { $('#f-body').replaceChildren(); say(humanError(err)); }
})();
