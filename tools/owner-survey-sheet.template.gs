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
 * Установка: Настройки проекта (шестерёнка) → Свойства скрипта → Добавить свойство
 * TEAM_CODE = код команды → Сохранить. Затем выбрать функцию setup и нажать «Выполнить».
 * Результат — в журнале выполнения внизу редактора.
 *
 * Файл собран из js/owner-survey-q.js (тексты вопросов дословно). Не править вопросы здесь —
 * поменяли опрос → node tools/build-owner-survey-gs.mjs и заменить код в Apps Script.
 */

var SUPABASE_URL = '__URL__';
var SUPABASE_KEY = '__KEY__'; // publishable: доступ определяют функции базы, не ключ
var SHEET_ANSWERS = 'Ответы';
var SHEET_QUESTIONS = 'Вопросы';
var TZ = 'Europe/Moscow';
var SHEET_ID = '1Ain4ya1uJBS2P0JNd4lMSYibgxprbI-28sREOeFGeAE'; // таблица команды; нужен, если скрипт создан не из таблицы

function book_() { return SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(SHEET_ID); }

var QUESTIONS = __QUESTIONS__;

/** Меню в таблице. */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Опрос Pet ID')
    .addItem('Обновить сейчас', 'sync')
    .addItem('Оформить листы заново', 'setupSheets')
    .addToUi();
}

/** Первый запуск: листы, синхронизация каждые 5 минут. Код команды — заранее в свойствах скрипта. */
function setup() {
  var code = PropertiesService.getScriptProperties().getProperty('TEAM_CODE');
  if (!code) throw new Error('Нет кода команды. Настройки проекта (шестерёнка слева) → Свойства скрипта → Добавить свойство: TEAM_CODE = код команды → Сохранить. Потом снова запустите setup.');
  setupSheets();
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'sync') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('sync').timeBased().everyMinutes(5).create();
  var n = sync();
  console.log('Готово: листы оформлены, синхронизация каждые 5 минут. Перенесено ответов: ' + n);
  return n;
}

function headers_() {
  return ['Дата и время (МСК)', 'Имя']
    .concat(QUESTIONS.map(function (q) { return q.id + '. ' + q.text; }))
    .concat(['Ключ (не менять)']);
}

/** Оформление: шапка, ширины, перенос, закрепление, фильтр; лист «Вопросы». Данные не трогает. */
function setupSheets() {
  var ss = book_();
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
  if (!code) throw new Error('Нет кода команды в свойствах скрипта (TEAM_CODE) — см. начало файла');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return 0;
  try {
    var res = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/rpc/owner_survey_export', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY },
      payload: JSON.stringify({ p_team: code })
    });
    if (res.getResponseCode() !== 200 && /нужен код/.test(res.getContentText())) throw new Error('Код команды не подошёл — проверьте свойство TEAM_CODE');
    if (res.getResponseCode() !== 200) throw new Error('База ответила ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
    var rows = JSON.parse(res.getContentText());
    var sh = book_().getSheetByName(SHEET_ANSWERS);
    if (!sh) { setupSheets(); sh = book_().getSheetByName(SHEET_ANSWERS); }
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
