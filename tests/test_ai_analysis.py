"""Offline contract tests. Mock replies are test fixtures, never production AI."""
import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError, URLError

import ai_analysis as ai
from simulator import evaluate

EXAMPLE = json.loads((ai.ROOT / "examples" / "organizer.json").read_text(encoding="utf-8"))
CONFIG = ai.Config("test-secret-not-a-real-key", "test-model", "https://provider.example/v1", "json_schema")


def fixture_report():
    return {"summary": "Тестовый ответ, не результат реальной модели.",
            "strengths": ["Поддержана социальная инфраструктура."],
            "risks": ["Проблемы транспорта остаются."],
            "recommendations": ["Сравнить транспортный сценарий отдельным расчётом."],
            "directions": [{"id": key, "explanation": "Тестовое пояснение направления."} for key in ai.DIRECTIONS],
            "measures": [{"id": d["measure"], "consequences": "Тестовое последствие.",
                          "possible_support": "Жители могут поддержать меру.",
                          "possible_concerns": "Жители могут опасаться задержек."} for d in EXAMPLE]}


def fixture_completion(report=None):
    return {"choices": [{"finish_reason": "stop", "message": {
        "content": json.dumps(fixture_report() if report is None else report), "refusal": None}}]}


class AITests(unittest.TestCase):
    def test_config_file_environment_override_and_secret_visibility(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env"
            path.write_text('# local\nAI_API_KEY="test-secret"\nAI_MODEL=from-file\n', encoding="utf-8-sig")
            config = ai.load_config(env={"AI_MODEL": "from-environment"}, path=path)
            self.assertEqual(config.model, "from-environment")
            self.assertEqual(config.key, "test-secret")
            self.assertNotIn(config.key, repr(config))
            with patch.object(ai, "load_config", return_value=config):
                status = ai.public_status()
            self.assertTrue(status["configured"])
            self.assertNotIn(config.key, json.dumps(status))
            with self.assertRaises(ai.AIError):
                ai.load_config(env={"AI_API_KEY": ""}, path=path)

    def test_invalid_urls_and_output_format(self):
        for base in ["http://provider.example/v1", "https://user:secret@provider.example/v1",
                     "https://provider.example/v1?key=secret", "invalid", "https://provider.example:bad"]:
            with self.subTest(base=base), self.assertRaises(ai.AIError):
                ai.load_config(env={"AI_API_KEY": "test", "AI_MODEL": "test", "AI_BASE_URL": base}, path=ai.ROOT / "does-not-exist.env")

    def test_request_uses_calculated_facts_and_selected_measures(self):
        payload, ids = ai.build_request(EXAMPLE, CONFIG)
        facts = json.loads(payload["messages"][1]["content"])
        self.assertAlmostEqual(facts["calculated_result"]["score"], 56.54307)
        self.assertEqual(set(ids), {"M5", "M7", "M8", "M10", "M12"})
        self.assertTrue(payload["response_format"]["json_schema"]["strict"])
        self.assertNotIn(CONFIG.key, json.dumps(payload))
        fallback = ai.Config(CONFIG.key, CONFIG.model, CONFIG.base_url, "json_object")
        self.assertEqual(ai.build_request(EXAMPLE, fallback)[0]["response_format"]["type"], "json_object")

    def test_valid_real_call_path_without_changing_score(self):
        before = evaluate(EXAMPLE)
        with patch.object(ai, "load_config", return_value=CONFIG), patch.object(ai, "call_provider", return_value=fixture_completion()) as provider:
            result = ai.analyze(EXAMPLE)
        self.assertEqual(result["method"], "llm")
        self.assertEqual(result["model"], CONFIG.model)
        self.assertEqual(len(result["report"]["measures"]), 5)
        self.assertEqual(provider.call_count, 1)
        self.assertEqual(evaluate(EXAMPLE), before)

    def test_invalid_and_unconfigured_never_call_provider(self):
        with patch.object(ai, "call_provider") as provider:
            with self.assertRaises(ai.AIError) as raised:
                ai.analyze([])
            self.assertEqual(raised.exception.status, 422)
            with patch.object(ai, "load_config", side_effect=ai.AIError("Нет ключа")):
                with self.assertRaises(ai.AIError):
                    ai.analyze(EXAMPLE)
            provider.assert_not_called()

    def test_incomplete_refused_malformed_and_missing_measure_are_rejected(self):
        partial = fixture_report()
        partial["measures"].pop()
        duplicate = fixture_report()
        duplicate["measures"][-1] = copy.deepcopy(duplicate["measures"][0])
        extra = fixture_report()
        extra["score"] = 100
        completions = [fixture_completion(partial), fixture_completion(duplicate), fixture_completion(extra),
                       {"choices": []}, {"choices": [None]}, {"choices": [{"finish_reason": "stop", "message": []}]},
                       {"choices": [{"finish_reason": "length", "message": {"content": "{}"}}]},
                       {"choices": [{"finish_reason": "stop", "message": {"refusal": "No", "content": None}}]},
                       {"choices": [{"finish_reason": "stop", "message": {"content": "bad JSON"}}]}]
        for completion in completions:
            with self.subTest(completion=completion), patch.object(ai, "load_config", return_value=CONFIG), patch.object(ai, "call_provider", return_value=completion):
                with self.assertRaises(ai.AIError) as raised:
                    ai.analyze(EXAMPLE)
                self.assertEqual(raised.exception.status, 502)

    def test_busy_and_provider_failure_release_slot(self):
        with patch.object(ai, "load_config", return_value=CONFIG), patch.object(ai, "call_provider", side_effect=ai.AIError("Недоступно")) as provider:
            ai.CALL_SLOT.acquire()
            try:
                with self.assertRaises(ai.AIError) as raised:
                    ai.analyze(EXAMPLE)
                self.assertEqual(raised.exception.status, 429)
                provider.assert_not_called()
            finally:
                ai.CALL_SLOT.release()
            with self.assertRaises(ai.AIError):
                ai.analyze(EXAMPLE)
            self.assertTrue(ai.CALL_SLOT.acquire(blocking=False))
            ai.CALL_SLOT.release()

    def test_provider_timeout_auth_and_bad_response_hide_secrets(self):
        for error in [TimeoutError(CONFIG.key), URLError(CONFIG.key),
                      HTTPError(CONFIG.base_url, 401, CONFIG.key, {}, None)]:
            with self.subTest(error=type(error)), patch.object(ai, "build_opener") as opener:
                opener.return_value.open.side_effect = error
                with self.assertRaises(ai.AIError) as raised:
                    ai.call_provider(CONFIG, {})
                self.assertNotIn(CONFIG.key, str(raised.exception))
        with patch.object(ai, "build_opener") as opener:
            opener.return_value.open.return_value.__enter__.return_value.read.return_value = b"not JSON"
            with self.assertRaises(ai.AIError):
                ai.call_provider(CONFIG, {})


if __name__ == "__main__":
    unittest.main()
