// П13: справочники городов и пород (data/, источники — data/README.md).
// Автодополнение идёт по локальному файлу, а не по Nominatim: политика Nominatim
// автодополнение прямо запрещает. Свободный ввод остаётся всегда.
let cities = null, breeds = null;
const get = async url => { const r = await fetch(url); if (!r.ok) throw new Error('Справочник не загрузился'); return r.json(); };

export async function loadCities() { if (!cities) cities = (await get('data/cities.json')).items; return cities; }
export const findCity = (list, label) => { const v = (label || '').trim().toLowerCase(); return list.find(c => c[0].toLowerCase() === v) || null; };

/** Подсказки по мере ввода: <datalist> с названием и регионом. */
export async function attachCities(input) {
  const list = await loadCities().catch(() => null);
  if (!list) return null;
  let dl = document.getElementById('dl-cities');
  if (!dl) {
    dl = document.createElement('datalist'); dl.id = 'dl-cities';
    for (const [label, region] of list) { const o = document.createElement('option'); o.value = label; o.label = region; dl.append(o); }
    document.body.append(dl);
  }
  input.setAttribute('list', 'dl-cities'); input.autocomplete = 'off';
  return list;
}

/** Координаты для профиля, если город выбран из справочника; иначе null — геокодер спросят один раз позже. */
export async function cityGeo(label) {
  const list = await loadCities().catch(() => null);
  const c = list && findCity(list, label);
  return c ? { city: c[0], city_lat: c[2], city_lon: c[3], city_geo_for: c[0] } : null;
}

export const BREED_FIRST = ['Беспородная', 'Метис'];
export async function attachBreeds(input, species) {
  if (!breeds) breeds = await get('data/breeds-dog.json').then(j => j.items).catch(() => []);
  const id = 'dl-breeds-' + species;
  let dl = document.getElementById(id);
  if (!dl) {
    dl = document.createElement('datalist'); dl.id = id;
    for (const b of [...BREED_FIRST, ...(species === 'dog' ? breeds : [])]) { const o = document.createElement('option'); o.value = b; dl.append(o); }
    document.body.append(dl);
  }
  input.setAttribute('list', id); input.autocomplete = 'off';
}
