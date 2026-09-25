// Проверка js/track.js: расстояние, точность, скачки, разрывы, приватная зона.
// Запуск: node test/track_check.mjs
import { haversine, distance, isBroken, toStore, accurate, PRIVATE_R_M } from '../js/track.js';
let bad = 0;
const ok = (name, c, info = '') => { if (!c) bad++; console.log(c ? 'PASS' : 'FAIL', name, info); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// 1° широты по дуге при R = 6371008,8 м = 111 195,08 м (2πR/360).
ok('1° широты', near(haversine({ lat: 59, lon: 30 }, { lat: 60, lon: 30 }), 2 * Math.PI * 6371008.8 / 360, 0.01));
// 1° долготы на 60° широты — вдвое короче экватора (cos 60° = 0,5) с точностью до сферы.
ok('1° долготы на 60°', near(haversine({ lat: 60, lon: 30 }, { lat: 60, lon: 31 }), 2 * Math.PI * 6371008.8 / 360 * 0.5, 30));

// Прямая на север, шаг 0,0001° ≈ 11,12 м, раз в 10 с (1,1 м/с — шаг).
const t0 = 1_700_000_000_000;
const line = n => Array.from({ length: n }, (_, i) => ({ t: t0 + i * 10000, lat: 59.95 + i * 0.0001, lon: 30.3, acc_m: 8 }));
const L = line(101);                                  // 100 шагов ≈ 1111,95 м
ok('длина прямой 100 шагов', near(distance(L), 1112, 1), distance(L));

// Точка с плохой точностью не участвует.
const P = L.map((p, i) => i === 50 ? { ...p, lat: p.lat + 0.01, acc_m: 120 } : p);
ok('точка acc 120 м отброшена', near(distance(P), 1112, 1) && accurate(P).length === 100, distance(P));

// Скачок GPS при хорошей заявленной точности: 1 км за 10 с = 100 м/с.
const J = L.map((p, i) => i === 50 ? { ...p, lat: p.lat + 0.009 } : p);
ok('скачок 100 м/с не считается', near(distance(J), 1112, 12), distance(J));

// Разрывы.
ok('ровный трек не рваный', !isBroken(L, { endT: L[100].t + 5000 }));
const G = L.map((p, i) => i >= 60 ? { ...p, t: p.t + 61000 } : p);
ok('разрыв 71 с → рваный', isBroken(G));
ok('вкладка уходила в фон → рваный', isBroken(L, { hidden: true }));
ok('трек оборван до конца прогулки → рваный', isBroken(L, { endT: L[100].t + 120000 }));

// Приватная зона: ни одна сохранённая точка не ближе 150 м к началу.
const S = toStore(L);
const home = L[0];
ok('в зоне ничего не сохраняется', S.every(p => haversine(home, p) > PRIVATE_R_M), `${S.length} из ${L.length}`);
ok('первая сохранённая точка дальше 150 м', S.length && haversine(home, S[0]) > PRIVATE_R_M && haversine(home, S[0]) < PRIVATE_R_M + 12);
// Круговой маршрут: вернулись домой — хвост тоже вырезан.
const loop = [...L, ...L.slice(0, 100).reverse().map((p, i) => ({ ...p, t: L[100].t + (i + 1) * 10000 }))];
const SL = toStore(loop);
ok('круг: хвост у дома вырезан', SL.every(p => haversine(home, p) > PRIVATE_R_M) && SL.length < loop.length - 2 * 13, `${SL.length} из ${loop.length}`);
// Если первая точка неточная — центр зоны берётся по первой точной.
const F = [{ ...L[0], lat: 59.9, acc_m: 500 }, ...L];
ok('центр зоны — первая точная точка', toStore(F).every(p => haversine(home, p) > PRIVATE_R_M));
ok('пустой трек', distance([]) === 0 && toStore([]).length === 0 && !isBroken([]));

console.log(bad ? `расхождений: ${bad}` : 'всё сходится');
process.exit(bad ? 1 : 0);
