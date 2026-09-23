"""Grounded, reproducible written conclusions. This module does not call an LLM.

Facts use the validated model output. Citizen reactions are authored hypotheses,
explicitly separated from computed effects, and never modify the score.
"""
import json
import math
from pathlib import Path

from simulator import baseline, load_data

INDICATORS = {
    "T1": "Разгрузка дорог", "T2": "Доступность общественного транспорта",
    "E1": "Озеленение", "E2": "Качество воздуха",
    "S1": "Школы и детсады", "S2": "Поликлиники и первичная помощь",
    "B1": "Безопасность улиц", "B2": "Безопасность движения",
    "C1": "Надёжность ЖКХ", "C2": "Скорость решения обращений",
}
DIRECTIONS = {
    "transport": ("Транспорт", ["T1", "T2"]),
    "ecology": ("Экология", ["E1", "E2"]),
    "social": ("Социальная инфраструктура", ["S1", "S2"]),
    "safety": ("Безопасность", ["B1", "B2"]),
    "services": ("Городские сервисы", ["C1", "C2"]),
}


def number(value, signed=False):
    text = f"{value:.2f}".rstrip("0").rstrip(".").replace(".", ",")
    return ("+" if signed and value > 0 else "") + text


def build_conclusion(decisions, result, data=None):
    """Use only a matching successful evaluate() result, never client-supplied scores."""
    if not result.get("valid"):
        return None
    data = load_data() if data is None else data
    before = baseline(data)
    catalog = {m["id"]: m for m in data["measures"]}
    chosen = {d["measure"]: d for d in decisions}
    notes = json.loads((Path(__file__).parent / "data" / "measure_explanations.json").read_text(encoding="utf-8"))
    effects_by_id = {e["measure"]: e for e in result["measure_effects"]}
    by_direction = []
    for direction, (title, keys) in DIRECTIONS.items():
        spent = sum(catalog[mid]["cost"] for mid in chosen if catalog[mid]["direction"] == direction)
        indicators = []
        for key in keys:
            old = math.fsum(d["population_share"] * before["indicators"][d["name"]][key] for d in data["districts"])
            new = math.fsum(d["population_share"] * result["indicators"][d["name"]][key] for d in data["districts"])
            indicators.append({"key": key, "label": INDICATORS[key], "before": old, "after": new, "delta": new-old})
        sources = {mid for mid in chosen if any(k in catalog[mid]["effects"] for k in keys)}
        for synergy in result["synergies"]:
            if any(k in synergy["effects"] for k in keys):
                sources.update(synergy["pair"])
        sources = sorted(sources, key=lambda mid: int(mid[1:]))
        changed = any(abs(item["delta"]) > 1e-9 for item in indicators)
        if not changed:
            explanation = "Показатели направления не изменились. Отсутствие вложений само по себе не ухудшает их: деградация со временем в датасете не задана. Существующие проблемы при этом остаются."
        else:
            description = "; ".join(f"{item['label']}: {number(item['before'])} → {number(item['after'])} ({number(item['delta'], True)})" for item in indicators)
            explanation = description + ". Источники эффектов: " + ", ".join(sources) + "."
            if spent == 0:
                explanation += " Прямых расходов на это направление нет, но на него действуют меры из других направлений."
            if any(item["delta"] < -1e-9 for item in indicators):
                explanation += " Есть ухудшение показателя — это предусмотренный датасетом компромисс."
        by_direction.append({"id": direction, "title": title, "spent": spent,
                             "indicators": indicators, "sources": sources, "text": explanation})

    measures = []
    for mid in sorted(chosen, key=lambda key: int(key[1:])):
        measure = catalog[mid]
        effect = effects_by_id[mid]
        scope = chosen[mid].get("district") if measure["scope"] == "district" else "Все пять районов"
        measures.append({
            "id": mid, "name": measure["name"], "scope": scope, "cost": measure["cost"],
            "lag": measure["lag"], "factor": effect["lag_factor"],
            "timing": f"Задержка — {measure['lag']} кв. Из {data['horizon']} кварталов горизонта учтено {number(effect['lag_factor'] * 100)}% заданного эффекта.",
            "effects": [{"key": k, "label": INDICATORS[k], "delta": v}
                        for k, v in effect["indicator_effects_before_clip"].items()],
            "mechanism": notes[mid]["mechanism"],
            "possible_support": notes[mid]["beneficiaries"],
            "possible_concerns": notes[mid]["concerns"],
        })

    synergies = [{"pair": s["pair"], "district": s["district"],
                  "text": f"{' + '.join(s['pair'])}, район {s['district']}: "
                          + ", ".join(f"{INDICATORS[k]} {number(v, True)}" for k, v in s["effects"].items())
                          + ". Бонус добавлен без уменьшения из-за задержки."}
                 for s in result["synergies"]]
    warnings = []
    critical_before = {(v["district"], v["indicator"]) for v in before["critical_indicators"]}
    critical_after = {(v["district"], v["indicator"]) for v in result["critical_indicators"]}
    resolved = sorted(critical_before - critical_after)
    if result["critical_indicators"]:
        warnings.append("Остались критические значения: " + "; ".join(
            f"{v['district']} — {INDICATORS[v['indicator']]} {number(v['value'])}"
            for v in result["critical_indicators"]) + ". Каждое значение ниже 40 оставляет штраф в один балл.")
    else:
        warnings.append("Критических значений ниже 40 не осталось. Это не означает, что все проблемы решены или все жители довольны.")
    weakest_score = result["weakest_district_score"]
    weakest = [name for name, score in result["district_scores"].items() if abs(score-weakest_score) < 1e-9]
    warnings.append(f"Самая низкая оценка района: {', '.join(weakest)} — {number(weakest_score)}. Она по-прежнему влияет на 30% формулы Score.")
    for effect in result["measure_effects"]:
        for key, delta in effect["indicator_effects_before_clip"].items():
            if delta < 0:
                warnings.append(f"Компромисс {effect['measure']}: {INDICATORS[key]} {number(delta, True)} в районе {', '.join(effect['districts'])}. Итоговое изменение также учитывает другие выбранные меры.")
    low = sorted((value, district, key) for district, values in result["indicators"].items()
                 for key, value in values.items() if 40 <= value < 50)[:3]
    if low:
        warnings.append("Показатели вне критической зоны, но всё ещё ниже 50: " + "; ".join(
            f"{district} — {INDICATORS[key]} {number(value)}" for value, district, key in low)
            + ". Порог 50 здесь только ориентир для внимания, дополнительного штрафа за него нет.")
    city_part = .7 * (result["city_average"] - before["city_average"])
    weak_part = .3 * (result["weakest_district_score"] - before["weakest_district_score"])
    penalty_part = before["critical_count"] - result["critical_count"]
    summary = (f"Выбрано пять мероприятий на {result['cost']} из {data['budget']} единиц бюджета; остаток — {result['remaining_budget']}. "
               f"На горизонте {data['horizon']} кварталов Score меняется с {number(before['score'])} до {number(result['score'])} "
               f"({number(result['score_change'], True)}). Число критических показателей: {before['critical_count']} → {result['critical_count']}.")
    return {
        "method": "rules", "title": "Что изменят ваши решения",
        "summary": summary,
        "score_explanation": f"Изменение Score складывается из среднего результата города ({number(city_part, True)}), "
                             f"результата самого слабого района ({number(weak_part, True)}) и изменения штрафов ({number(penalty_part, True)}). "
                             "Отображённые части округлены; расчёт выполняется без округления.",
        "resolved_critical": [f"{district}: {INDICATORS[key]}" for district, key in resolved],
        "directions": by_direction, "measures": measures, "synergies": synergies, "watchpoints": warnings,
        "model_note": "Числа взяты из расчёта по синтетическому датасету. Индексы — не проценты удовлетворённости, не объём выбросов и не реальный прогноз.",
        "reaction_note": "Реакция жителей — возможные качественные сценарии. Опросов, долей довольных жителей и модели общественного мнения в данных нет. Эти предположения не меняют Score.",
        "method_note": "Заключение сформировано по правилам и пояснениям мероприятий, без LLM. Для отдельного AI-анализа подключите модель и используйте кнопку в веб-интерфейсе.",
    }
