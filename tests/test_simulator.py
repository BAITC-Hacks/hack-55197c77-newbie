import copy
import json
from pathlib import Path
import unittest
from simulator import baseline, evaluate, load_data, summarize


class SimulatorTests(unittest.TestCase):
    def setUp(self):
        self.example = json.loads((Path(__file__).parents[1] / "examples" / "organizer.json").read_text(encoding="utf-8"))

    def test_baseline_matches_organizer(self):
        result = baseline()
        self.assertAlmostEqual(result["score"], 52.55768)
        self.assertEqual(result["critical_count"], 2)

    def test_reference_scenario(self):
        result = evaluate(self.example)
        self.assertTrue(result["valid"])
        self.assertEqual(result["cost"], 95)
        self.assertAlmostEqual(result["score"], 56.54307)
        self.assertEqual(result["critical_count"], 0)
        self.assertAlmostEqual(result["indicators"]["Нура"]["B1"], 67.5)
        self.assertEqual(len(result["synergies"]), 1)

    def test_order_does_not_matter(self):
        self.assertEqual(evaluate(self.example), evaluate(list(reversed(self.example))))

    def test_invalid_scenarios_have_no_score(self):
        invalid = [None, {}, self.example[:4], self.example + [self.example[0]],
                   [self.example[0]] * 5]
        for replacement in [{"measure":"UNKNOWN"}, {"measure":[]},
                            {"measure":"M7"}, {"measure":"M7","district":"unknown"},
                            {"measure":"M12","district":"Нура"}, "bad"]:
            invalid.append([replacement] + self.example[1:])
        for scenario in invalid:
            with self.subTest(scenario=scenario):
                result = evaluate(scenario)
                self.assertFalse(result["valid"])
                self.assertIsNone(result["score"])
                self.assertTrue(result["errors"])

    def test_over_budget(self):
        scenario = [{"measure":"M3","district":"Есиль"},
                    {"measure":"M5","district":"Сарыарка"},
                    {"measure":"M7","district":"Нура"},
                    {"measure":"M10","district":"Нура"}, {"measure":"M14"}]
        self.assertTrue(any("Бюджет" in e for e in evaluate(scenario)["errors"]))

    def test_three_measures_of_one_direction(self):
        scenario = [{"measure":m,"district":"Нура"} for m in ["M7","M8","M9","M10"]] + [{"measure":"M12"}]
        self.assertTrue(any("направления" in e for e in evaluate(scenario)["errors"]))

    def test_all_incompatibilities(self):
        for a, b, same_only in [("M1","M3",False),("M4","M7",True),("M5","M13",True)]:
            scenario = [{"measure":a,"district":"Нура"}, {"measure":b,"district":"Нура"},
                        {"measure":"M9","district":"Есиль"}, {"measure":"M11","district":"Есиль"}, {"measure":"M12"}]
            self.assertTrue(any("Несовместимые" in e for e in evaluate(scenario)["errors"]))
            scenario[1]["district"] = "Алматы"
            conflicts = any("Несовместимые" in e for e in evaluate(scenario)["errors"])
            self.assertEqual(conflicts, not same_only)

    def test_critical_threshold_is_strict(self):
        data = load_data()
        values = {d["name"]: {k:40 for k in data["weights"]} for d in data["districts"]}
        self.assertEqual(summarize(values, data)["critical_count"], 0)
        values["Нура"]["S1"] = 39.99
        self.assertEqual(summarize(values, data)["critical_count"], 1)

    def test_clip_and_input_immutability(self):
        data = load_data()
        for d in data["districts"]:
            d["indicators"] = {k:99 for k in data["weights"]}
        original = copy.deepcopy(data)
        result = evaluate(self.example, data)
        self.assertEqual(data, original)
        self.assertEqual(result["indicators"]["Нура"]["S1"], 100)
        self.assertTrue(all(0 <= v <= 100 for values in result["indicators"].values() for v in values.values()))


if __name__ == "__main__":
    unittest.main()
