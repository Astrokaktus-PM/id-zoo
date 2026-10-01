/**
 * Pet ID — опрос владельцев собак → Google Таблица.
 *
 * Копирует ответы из базы (Supabase, таблица owner_surveys) в эту таблицу: лист «Ответы» —
 * одна строка на ответ, лист «Вопросы» — справочник вопросов и вариантов.
 * Источник правды — база; таблица — копия для просмотра и анализа.
 *
 * Как работает: раз в 5 минут функция sync() забирает все ответы функцией
 * owner_survey_export(код команды) и дописывает те, которых ещё нет (ключ — время отправки).
 * Код команды хранится в «Свойствах скрипта» (TEAM_CODE), в коде его нет.
 *
 * Файл собран из js/owner-survey-q.js (тексты вопросов дословно). Не править вопросы здесь —
 * поменяли опрос → node tools/build-owner-survey-gs.mjs и заменить код в Apps Script.
 */

var SUPABASE_URL = 'https://vpglibkbscsqijsmounx.supabase.co';
var SUPABASE_KEY = 'sb_publishable_rA1BJ6bGoHlbCkaHbA8wxw_HZlj0erW'; // publishable: доступ определяют функции базы, не ключ
var SHEET_ANSWERS = 'Ответы';
var SHEET_QUESTIONS = 'Вопросы';
var TZ = 'Europe/Moscow';

var QUESTIONS = [
 {
  "id": 1,
  "section": "О вас и собаке",
  "text": "Сколько у вас собак?",
  "type": "single",
  "options": [
   "1",
   "2",
   "3 и более"
  ],
  "max": null,
  "required": true,
  "hint": null,
  "min": null,
  "maxScale": null,
  "minLabel": null,
  "maxLabel": null
 },
 {
  "id": 2,
  "section": "О вас и собаке",
  "text": "Сколько лет вашей собаке?",
  "type": "multi",
  "options": [
   "Меньше 1 года",
   "1–3 года",
   "4–7 лет",
   "8 лет и старше"
  ],
  "max": null,
  "required": true,
  "hint": "Если собак несколько, можно выбрать несколько вариантов.",
  "min": null,
  "maxScale": null,
  "minLabel": null,
  "maxLabel": null
 },
 {
  "id": 3,
  "section": "Прогулки",
  "text": "Как часто вы гуляете с собакой?",
  "type": "single",
  "options": [
   "1 раз в день",
   "2 раза в день",
   "3 и более раз в день",
   "Нерегулярно"
  ],
  "max": null,
  "required": true,
  "hint": null,
  "min": null,
  "maxScale": null,
  "minLabel": null,
  "maxLabel": null
 },
 {
  "id": 4,
  "section": "Прогулки",
  "text": "Сколько в среднем длится одна прогулка?",
  "type": "single",
  "options": [
   "Меньше 15 минут",
   "15–30 минут",
   "30–60 минут",
   "Более 60 минут"
  ],
  "max": null,
  "required": true,
  "hint": null,
  "min": null,
  "maxScale": null,
  "minLabel": null,
  "maxLabel": null
 },
 {
  "id": 5,
  "section": "Текущие решения",
  "text": "Используете ли вы сейчас приложение или устройство для отслеживания активности или местоположения собаки?",
  "type": "single",
  "options": [
   "Нет",
   "Да, приложение",
   "Да, GPS-трекер",
   "Да, Apple AirTag",
   "Другое"
  ],
  "max": null,
  "required": true,
  "hint": null,
  "min": null,
  "maxScale": null,
  "minLabel": null,
  "maxLabel": null
 },
 {
  "id": 6,
  "section": "Потребности",
  "text": "Что из этого было бы полезно иметь в одном приложении?",
  "type": "multi",
  "options": [
   "GPS / местоположение в реальном времени",
   "История прогулок и маршрутов",
   "Активность и физическая нагрузка",
   "Цифровой паспорт здоровья",
   "Напоминания о вакцинации и обработках",
   "Напоминания о лекарствах",
   "Карта ветеринарных клиник",
   "Карта зоомагазинов и ветаптек",
   "Собачьи площадки и места для прогулок",
   "Гостиницы / передержки для животных",
   "События для владельцев собак",
   "Помощь при потере собаки",
   "Доступ для членов семьи",
   "Игры / достижения / челленджи",
   "Телемедицина",
   "Страхование питомца",
   "Возможность общаться с другими пользователями приложения",
   "Другое"
  ],
  "max": 5,
  "required": true,
  "hint": "Выберите до 5 вариантов.",
  "min": null,
  "maxScale": null,
  "minLabel": null,
  "maxLabel": null
 },
 {
  "id": 7,
  "section": "Проблемы",
  "text": "Что сегодня больше всего неудобно в уходе за собакой?",
  "type": "multi",
  "options": [
   "Следить за здоровьем и вакцинациями",
   "Не забывать о лекарствах и обработках",
   "Контролировать активность и прогулки",
   "Понимать, достаточно ли собака двигается",
   "Следить за местоположением",
   "Хранить документы и медицинскую информацию",
   "Быстро находить нужные места и сервисы",
   "Искать передержку / гостиницу",
   "Организовывать поездки с собакой",
   "Находить мероприятия",
   "Другое"
  ],
  "max": null,
  "required": true,
  "hint": "Можно выбрать несколько вариантов.",
  "min": null,
  "maxScale": null,
  "minLabel": null,
  "maxLabel": null
 },
 {
  "id": 8,
  "section": "Регулярное использование",
  "text": "Что заставило бы вас открывать приложение регулярно?",
  "type": "multi",
  "options": [
   "Возможность увидеть, где находится собака",
   "Статистика прогулок",
   "Активность и здоровье",
   "Полезные рекомендации",
   "Достижения и личные рекорды",
   "Новые маршруты для прогулок",
   "Сравнение показателей",
   "Напоминания о здоровье",
   "Полезные места рядом",
   "Челленджи",
   "Скидки и бонусы",
   "События",
   "Другое"
  ],
  "max": null,
  "required": true,
  "hint": "Можно выбрать несколько вариантов.",
  "min": null,
  "maxScale": null,
  "minLabel": null,
  "maxLabel": null
 },
 {
  "id": 9,
  "section": "Во время прогулки",
  "text": "Что было бы наиболее полезно для вас непосредственно во время прогулки?",
  "type": "multi",
  "options": [
   "Отслеживание местоположения",
   "Запись маршрута",
   "Расстояние и время прогулки",
   "Контроль активности",
   "Безопасная зона / уведомление при выходе из неё",
   "Поиск ближайшего ветеринара",
   "Поиск dog-friendly мест",
   "Новые маршруты",
   "Другое"
  ],
  "max": null,
  "required": true,
  "hint": "Можно выбрать несколько вариантов.",
  "min": null,
  "maxScale": null,
  "minLabel": null,
  "maxLabel": null
 },
 {
  "id": 10,
  "section": "Безопасность",
  "text": "Насколько для вас важно знать, где находится собака, когда она гуляет без вас?",
  "type": "scale",
  "options": null,
  "max": 5,
  "required": true,
  "hint": null,
  "min": 1,
  "maxScale": 5,
  "minLabel": "совсем не важно",
  "maxLabel": "очень важно"
 },
 {
  "id": 11,
  "section": "Потеря собаки",
  "text": "Если собака потеряется, какие функции были бы для вас наиболее полезны?",
  "type": "multi",
  "options": [
   "Быстрое включение режима «Собака потерялась»",
   "GPS / последняя известная точка",
   "Уведомление людей поблизости",
   "QR-код на ошейнике",
   "Публичный профиль собаки с контактами владельца",
   "Возможность сообщить о найденной собаке",
   "Карта местонахождений / сообщений",
   "Другое"
  ],
  "max": 3,
  "required": true,
  "hint": "Выберите до 3 вариантов.",
  "min": null,
  "maxScale": null,
  "minLabel": null,
  "maxLabel": null
 },
 {
  "id": 12,
  "section": "Цифровой паспорт",
  "text": "Хотели бы вы хранить всю информацию о собаке в одном цифровом паспорте?",
  "type": "single",
  "options": [
   "Да",
   "Скорее да",
   "Скорее нет",
   "Нет"
  ],
  "max": null,
  "required": true,
  "hint": null,
  "min": null,
  "maxScale": null,
  "minLabel": null,
  "maxLabel": null
 },
 {
  "id": 13,
  "section": "Уведомления",
  "text": "Какие уведомления были бы действительно полезны для вас?",
  "type": "multi",
  "options": [
   "Пора на прогулку",
   "Собака гуляла меньше обычного",
   "Достигнута дневная цель активности",
   "Новый личный рекорд",
   "Серия дней без пропусков",
   "Собака вышла из безопасной зоны",
   "Напоминание о вакцинации / обработке",
   "Новое dog-friendly место рядом",
   "Новое мероприятие рядом",
   "Новый челлендж",
   "Никакие"
  ],
  "max": null,
  "required": true,
  "hint": "Можно выбрать несколько вариантов.",
  "min": null,
  "maxScale": null,
  "minLabel": null,
  "maxLabel": null
 },
 {
  "id": 14,
  "section": "Оплата",
  "text": "За какие функции вы потенциально готовы платить?",
  "type": "multi",
  "options": [
   "GPS-отслеживание",
   "Расширенная аналитика активности",
   "Расширенный цифровой паспорт",
   "Медицинские функции",
   "Аналитика здоровья",
   "Страхование питомца",
   "Расширенный режим поиска потерянной собаки",
   "Семейный аккаунт",
   "Премиум-игры / челленджи",
   "Полная подписка на приложение",
   "Ни за какие",
   "Другое"
  ],
  "max": null,
  "required": true,
  "hint": "Можно выбрать несколько вариантов.",
  "min": null,
  "maxScale": null,
  "minLabel": null,
  "maxLabel": null
 },
 {
  "id": 15,
  "section": "Оплата",
  "text": "Какая стоимость подписки в месяц кажется вам приемлемой?",
  "type": "single",
  "options": [
   "Бесплатно",
   "До 199 ₽",
   "200–399 ₽",
   "400–699 ₽",
   "700 ₽ и выше",
   "Предпочитаю разовую покупку"
  ],
  "max": null,
  "required": false,
  "hint": null,
  "min": null,
  "maxScale": null,
  "minLabel": null,
  "maxLabel": null
 },
 {
  "id": 16,
  "section": "Финальный вопрос",
  "text": "Представьте, что вы пользуетесь нашим приложением через 6 месяцев. Что должно в нём быть, чтобы вы не удалили его?",
  "type": "text",
  "options": null,
  "max": null,
  "required": true,
  "hint": null,
  "min": null,
  "maxScale": null,
  "minLabel": null,
  "maxLabel": null
 }
];

/** Меню в таблице. */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Опрос Pet ID')
    .addItem('Обновить сейчас', 'sync')
    .addItem('Оформить листы заново', 'setupSheets')
    .addToUi();
}

/** Первый запуск: код команды, листы, синхронизация каждые 5 минут. */
function setup() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('Код команды', 'Тот же код, что для анкеты интервью. Хранится в свойствах скрипта, в таблицу не пишется.', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK || !r.getResponseText().trim()) return;
  PropertiesService.getScriptProperties().setProperty('TEAM_CODE', r.getResponseText().trim());
  setupSheets();
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'sync') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('sync').timeBased().everyMinutes(5).create();
  var n = sync();
  ui.alert('Готово', 'Листы оформлены, синхронизация — каждые 5 минут. Сейчас перенесено ответов: ' + n + '.', ui.ButtonSet.OK);
}

function headers_() {
  return ['Дата и время (МСК)', 'Имя']
    .concat(QUESTIONS.map(function (q) { return q.id + '. ' + q.text; }))
    .concat(['Ключ (не менять)']);
}

/** Оформление: шапка, ширины, перенос, закрепление, фильтр; лист «Вопросы». Данные не трогает. */
function setupSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_ANSWERS) || ss.insertSheet(SHEET_ANSWERS, 0);
  var h = headers_(), cols = h.length;
  if (sh.getMaxColumns() < cols) sh.insertColumnsAfter(sh.getMaxColumns(), cols - sh.getMaxColumns());
  sh.getRange(1, 1, 1, cols).setValues([h])
    .setFontWeight('bold').setWrap(true).setVerticalAlignment('top').setBackground('#fbe9df');
  sh.setFrozenRows(1); sh.setFrozenColumns(2);
  sh.setRowHeight(1, 90);
  sh.setColumnWidth(1, 140); sh.setColumnWidth(2, 110);
  QUESTIONS.forEach(function (q, i) {
    var w = q.type === 'text' ? 360 : (q.type === 'multi' ? 260 : 150);
    sh.setColumnWidth(3 + i, w);
  });
  sh.setColumnWidth(cols, 120);
  var body = sh.getRange(2, 1, Math.max(sh.getMaxRows() - 1, 1), cols);
  body.setWrap(true).setVerticalAlignment('top');
  sh.getRange(2, 1, Math.max(sh.getMaxRows() - 1, 1), 1).setNumberFormat('dd.MM.yyyy HH:mm');
  sh.getRange(2, cols, Math.max(sh.getMaxRows() - 1, 1), 1).setNumberFormat('@');
  sh.hideColumns(cols);
  if (!sh.getFilter()) sh.getRange(1, 1, sh.getMaxRows(), cols).createFilter();

  var qs = ss.getSheetByName(SHEET_QUESTIONS) || ss.insertSheet(SHEET_QUESTIONS);
  qs.clear();
  var rows = [['№', 'Раздел', 'Вопрос', 'Тип', 'Обязательный', 'Варианты']];
  var TYPE = { single: 'один вариант', multi: 'несколько вариантов', scale: 'шкала', text: 'свободный ответ' };
  QUESTIONS.forEach(function (q) {
    var t = TYPE[q.type] + (q.max && q.type === 'multi' ? ' (до ' + q.max + ')' : '');
    var opts = q.options ? q.options.join('\n') : (q.type === 'scale' ? q.min + ' — ' + q.minLabel + '\n' + q.maxScale + ' — ' + q.maxLabel : '');
    rows.push([q.id, q.section, q.text, t, q.required ? 'да' : 'нет', opts]);
  });
  qs.getRange(1, 1, rows.length, rows[0].length).setValues(rows).setWrap(true).setVerticalAlignment('top');
  qs.getRange(1, 1, 1, rows[0].length).setFontWeight('bold').setBackground('#fbe9df');
  qs.setFrozenRows(1);
  [40, 170, 360, 170, 110, 360].forEach(function (w, i) { qs.setColumnWidth(i + 1, w); });
}

/** Перенос новых ответов. Возвращает, сколько строк добавлено. */
function sync() {
  var code = PropertiesService.getScriptProperties().getProperty('TEAM_CODE');
  if (!code) throw new Error('Не задан код команды: запустите setup()');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return 0;
  try {
    var res = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/rpc/owner_survey_export', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY },
      payload: JSON.stringify({ p_team: code })
    });
    if (res.getResponseCode() !== 200) throw new Error('База ответила ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
    var rows = JSON.parse(res.getContentText());
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_ANSWERS);
    if (!sh) { setupSheets(); sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_ANSWERS); }
    var cols = headers_().length, last = sh.getLastRow();
    var seen = {};
    if (last > 1) sh.getRange(2, cols, last - 1, 1).getDisplayValues().forEach(function (r) { seen[r[0]] = true; });
    var out = [];
    rows.forEach(function (r) {
      if (seen[r.submitted_at]) return;
      var a = r.answers || {};
      out.push([new Date(r.submitted_at), r.name || '']
        .concat(QUESTIONS.map(function (q) { return safe_(a['q' + q.id]); }))
        .concat([r.submitted_at]));
    });
    if (out.length) sh.getRange(last + 1, 1, out.length, cols).setValues(out);
    return out.length;
  } finally { lock.releaseLock(); }
}

/** Текст ответа в ячейку: не даём таблице принять ответ за формулу. */
function safe_(v) {
  if (v === undefined || v === null) return '';
  var s = String(v);
  return /^[=+\-@]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s) ? "'" + s : s;
}
