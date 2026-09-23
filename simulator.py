"""Deterministic city model based on the organizer's synthetic dataset."""
import copy
import json
import math
from collections import Counter
from pathlib import Path

DATA_PATH = Path(__file__).parent / "data" / "city.json"


def load_data():
    return json.loads(DATA_PATH.read_text(encoding="utf-8"))


def validate(decisions, data):
    """Return all user-facing validation errors; never score invalid input."""
    if not isinstance(decisions, list):
        return ["Сценарий должен быть списком решений."]
    errors = []
    if len(decisions) != 5:
        errors.append("Требуется ровно 5 решений.")
    catalog = {m["id"]: m for m in data["measures"]}
    districts = {d["name"] for d in data["districts"]}
    selected = {}
    directions = Counter()
    cost = 0
    for i, decision in enumerate(decisions, 1):
        if not isinstance(decision, dict):
            errors.append(f"Решение {i}: ожидается объект.")
            continue
        mid = decision.get("measure")
        if not isinstance(mid, str) or mid not in catalog:
            errors.append(f"Решение {i}: неизвестное мероприятие.")
            continue
        if mid in selected:
            errors.append(f"Повтор мероприятия {mid} запрещён.")
        selected[mid] = decision
        measure = catalog[mid]
        district = decision.get("district")
        if measure["scope"] == "district":
            if not isinstance(district, str) or district not in districts:
                errors.append(f"{mid}: укажите существующий район.")
        elif district is not None:
            errors.append(f"{mid}: для городской меры район не указывается.")
        cost += measure["cost"]
        directions[measure["direction"]] += 1
    if cost > data["budget"]:
        errors.append(f"Бюджет превышен: {cost} > {data['budget']}.")
    for direction, count in directions.items():
        if count > 2:
            errors.append(f"Не более 2 мер одного направления: {direction}.")
    for rule in data["incompatibilities"]:
        a, b = rule["pair"]
        if a in selected and b in selected:
            if (not rule["same_district_only"]
                    or selected[a].get("district") == selected[b].get("district")):
                errors.append(f"Несовместимые мероприятия: {a} и {b}.")
    return errors


def summarize(indicators, data):
    district_scores = {
        name: math.fsum(values[k] * w for k, w in data["weights"].items())
        for name, values in indicators.items()
    }
    average = math.fsum(d["population_share"] * district_scores[d["name"]]
                        for d in data["districts"])
    critical = [{"district": name, "indicator": k, "value": value}
                for name, values in indicators.items()
                for k, value in values.items() if value < 40]
    return {
        "indicators": indicators,
        "district_scores": district_scores,
        "city_average": average,
        "weakest_district_score": min(district_scores.values()),
        "critical_count": len(critical),
        "critical_indicators": critical,
        "score": .7 * average + .3 * min(district_scores.values()) - len(critical),
    }


def baseline(data=None):
    data = load_data() if data is None else data
    return summarize({d["name"]: copy.deepcopy(d["indicators"])
                      for d in data["districts"]}, data)


def evaluate(decisions, data=None):
    data = load_data() if data is None else data
    errors = validate(decisions, data)
    if errors:
        return {"valid": False, "errors": errors, "score": None}
    before = baseline(data)
    indicators = copy.deepcopy(before["indicators"])
    catalog = {m["id"]: m for m in data["measures"]}
    selected = {d["measure"]: d for d in decisions}
    effects = []
    # Canonical order makes calculation independent of input order.
    for mid in sorted(selected):
        decision, measure = selected[mid], catalog[mid]
        targets = ([decision["district"]] if measure["scope"] == "district"
                   else list(indicators))
        factor = (data["horizon"] - measure["lag"]) / data["horizon"]
        delta = {k: value * factor for k, value in measure["effects"].items()}
        for district in targets:
            for k, value in delta.items():
                indicators[district][k] += value
        effects.append({"measure": mid, "districts": targets,
                        "lag_factor": factor, "indicator_effects_before_clip": delta})
    synergies = []
    for rule in data["synergies"]:
        a, b = rule["pair"]
        if a in selected and b in selected:
            district = selected[a]["district"]
            for k, value in rule["effects"].items():
                indicators[district][k] += value
            synergies.append({"pair": rule["pair"], "district": district,
                              "effects": rule["effects"]})
    # Clip once after ALL effects, as prescribed by the formula.
    indicators = {name: {k: max(0, min(100, v)) for k, v in values.items()}
                  for name, values in indicators.items()}
    result = summarize(indicators, data)
    cost = sum(catalog[mid]["cost"] for mid in selected)
    result.update({
        "valid": True, "errors": [], "cost": cost,
        "remaining_budget": data["budget"] - cost,
        "baseline_score": before["score"], "score_change": result["score"] - before["score"],
        "district_changes": {name: value - before["district_scores"][name]
                             for name, value in result["district_scores"].items()},
        "indicator_changes": {name: {k: v - before["indicators"][name][k]
                                     for k, v in values.items()}
                              for name, values in indicators.items()},
        "measure_effects": effects, "synergies": synergies,
    })
    return result
