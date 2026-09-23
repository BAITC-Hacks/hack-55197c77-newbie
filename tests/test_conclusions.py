import copy
import itertools
import json
from pathlib import Path
import unittest

from conclusions import build_conclusion
from simulator import evaluate, load_data, validate


class ConclusionTests(unittest.TestCase):
    def setUp(self):
        self.example = json.loads((Path(__file__).parents[1] / "examples" / "organizer.json").read_text(encoding="utf-8"))

    def report(self, decisions):
        result = evaluate(decisions)
        self.assertTrue(result["valid"], result.get("errors"))
        return build_conclusion(decisions, result)

    def test_example_is_grounded_and_does_not_change_score(self):
        result = evaluate(self.example)
        original = copy.deepcopy(result)
        report = build_conclusion(self.example, result)
        self.assertEqual(result, original)
        self.assertEqual(report["method"], "rules")
        self.assertEqual(len(report["measures"]), 5)
        self.assertEqual(len(report["directions"]), 5)
        self.assertEqual(len(report["resolved_critical"]), 2)
        self.assertIn("56,54", report["summary"])
        m10 = next(m for m in report["measures"] if m["id"] == "M10")
        self.assertEqual(next(e["delta"] for e in m10["effects"] if e["key"] == "B1"), 10.5)
        self.assertEqual(len(report["synergies"]), 1)
        self.assertIn("+2", report["synergies"][0]["text"])
        safety = next(d for d in report["directions"] if d["id"] == "safety")
        self.assertEqual(safety["sources"], ["M10", "M12"])
        transport = next(d for d in report["directions"] if d["id"] == "transport")
        self.assertEqual(transport["spent"], 0)
        self.assertTrue(all(i["delta"] == 0 for i in transport["indicators"]))
        self.assertIn("не изменились", transport["text"])

    def test_lrt_can_improve_ecology_without_ecology_spend(self):
        scenario = [{"measure":"M3","district":"Нура"}, {"measure":"M7","district":"Нура"},
                    {"measure":"M9","district":"Есиль"}, {"measure":"M10","district":"Нура"}, {"measure":"M12"}]
        report = self.report(scenario)
        ecology = next(d for d in report["directions"] if d["id"] == "ecology")
        self.assertEqual(ecology["spent"], 0)
        self.assertEqual(ecology["sources"], ["M3"])
        self.assertAlmostEqual(next(i["delta"] for i in ecology["indicators"] if i["key"] == "E2"), .32)
        lrt = next(m for m in report["measures"] if m["id"] == "M3")
        self.assertEqual(lrt["factor"], .5)
        self.assertIn("не объём выбросов", lrt["mechanism"])

    def test_negative_traffic_and_critical_problems_are_retained(self):
        scenario = [{"measure":"M9","district":"Есиль"}, {"measure":"M11","district":"Есиль"},
                    {"measure":"M10","district":"Есиль"}, {"measure":"M12"}, {"measure":"M4","district":"Есиль"}]
        report = self.report(scenario)
        transport = next(d for d in report["directions"] if d["id"] == "transport")
        self.assertLess(transport["indicators"][0]["delta"], 0)
        self.assertTrue(any("Остались критические" in text for text in report["watchpoints"]))
        self.assertTrue(any("-1,75" in text for text in report["watchpoints"]))
        self.assertEqual(report["resolved_critical"], [])

    def test_all_fourteen_measures_have_explanations_in_valid_scenarios(self):
        data = load_data()
        covered = set()
        for combo in itertools.combinations(data["measures"], 5):
            if all(m["id"] in covered for m in combo):
                continue
            # Different assignments handle spatial conflicts without exhaustive search.
            scenario = [{"measure":m["id"], **({"district":data["districts"][i]["name"]} if m["scope"] == "district" else {})}
                        for i, m in enumerate(combo)]
            if validate(scenario, data):
                continue
            report = self.report(scenario)
            for m in report["measures"]:
                self.assertTrue(m["mechanism"] and m["possible_support"] and m["possible_concerns"])
                covered.add(m["id"])
            if len(covered) == 14:
                break
        self.assertEqual(covered, {m["id"] for m in data["measures"]})

    def test_invalid_scenario_has_no_conclusion(self):
        self.assertIsNone(build_conclusion([], evaluate([])))
