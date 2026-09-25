# Генерирует test/d5_fixture.json из d5_model.py (исполняемой спецификации).
# Запуск: python test/d5_fixture.py путь/к/d5_model.py
import sys, json, random, importlib.util
spec = importlib.util.spec_from_file_location('d5m', sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
rnd = random.Random(20260925); cases = []
def val(norm):
    c = rnd.random()
    if c < 0.08: return 0
    if c < 0.16: return norm
    if c < 0.24: return rnd.choice([0.5, 2.5, 7.5, 12.5, 0.25, 0.75, 1.5])
    return rnd.choice([rnd.randint(0, int(norm * 2.2)), round(rnd.uniform(0, norm * 1.6), 1)])
N = int(sys.argv[2]) if len(sys.argv) > 2 else 300
for i in range(N):
    sp = rnd.choice(['dog', 'cat']); today = {}; week = {}
    for key, _, _, norm, per, _, _ in m.CH[sp]:
        if rnd.random() < 0.7:
            (week if per == 'week' else today)[key] = val(norm)
    gates = {g[0]: rnd.choice('AAAAABCDE') for g in m.GATES if rnd.random() < 0.5}
    r = m.d5(sp, today, week, gates)
    daily = [round(rnd.uniform(0, 100), 1) for _ in range(rnd.randint(1, 10))]
    cases.append(dict(sp=sp, today=today, week=week, gates=gates, daily=daily,
        d5=r, verdict=m.verdict(r), advice=m.advice(sp, today, week, gates),
        day_card=[x for x in m.day_card(sp, today, week, gates)],
        rolling=m.rolling(daily), week_card=list(m.week_card(daily))))
json.dump(cases, open('d5_fixture.json', 'w'), ensure_ascii=False)
print(len(cases), 'cases')
