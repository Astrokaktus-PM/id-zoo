// Собирает tools/owner-survey-sheet.gs из шаблона и js/owner-survey-q.js (тексты вопросов дословно).
// Запуск из корня репозитория: node tools/build-owner-survey-gs.mjs
import fs from 'fs';
import { QUESTIONS } from '../js/owner-survey-q.js';
import { SUPABASE_URL, SUPABASE_KEY } from '../js/config.js';
const qs = JSON.stringify(QUESTIONS.map(q => ({
  id: q.id, section: q.section, text: q.text, type: q.type, options: q.options || null,
  max: q.max || null, required: q.required, hint: q.hint || null, min: q.min || null,
  maxScale: q.type === 'scale' ? q.max : null, minLabel: q.minLabel || null, maxLabel: q.maxLabel || null,
})), null, 1);
const tpl = fs.readFileSync(new URL('./owner-survey-sheet.template.gs', import.meta.url), 'utf8');
fs.writeFileSync(new URL('./owner-survey-sheet.gs', import.meta.url),
  tpl.replace('__QUESTIONS__', qs).replace('__URL__', SUPABASE_URL).replace('__KEY__', SUPABASE_KEY));
console.log('tools/owner-survey-sheet.gs собран');
