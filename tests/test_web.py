import http.client
import json
import threading
import unittest
from unittest.mock import patch
from http.server import ThreadingHTTPServer

from web_server import Handler, ROOT
from ai_analysis import AIError
from test_ai_analysis import CONFIG, fixture_completion


class WebTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.worker = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.worker.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.worker.join()

    def request(self, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=5)
        try:
            connection.request(method, path, body=body, headers=headers or {})
            response = connection.getresponse()
            return response.status, response.read()
        finally:
            connection.close()

    def test_bootstrap_and_static(self):
        status, content = self.request("GET", "/api/data")
        payload = json.loads(content)
        self.assertEqual(status, 200)
        self.assertEqual(len(payload["data"]["districts"]), 5)
        self.assertEqual(payload["baseline"]["critical_count"], 2)
        for path in ["/", "/app.css", "/conclusion.css", "/app.js"]:
            self.assertEqual(self.request("GET", path)[0], 200)

    def test_calculate_and_reject_invalid(self):
        example = (ROOT / "examples" / "organizer.json").read_bytes()
        headers = {"Content-Type": "application/json"}
        status, content = self.request("POST", "/api/evaluate", example, headers)
        self.assertEqual(status, 200)
        self.assertAlmostEqual(json.loads(content)["score"], 56.54307)
        self.assertEqual(len(json.loads(content)["conclusion"]["measures"]), 5)
        status, content = self.request("POST", "/api/evaluate", b"[]", headers)
        self.assertEqual(status, 422)
        self.assertIsNone(json.loads(content)["score"])
        self.assertNotIn("conclusion", json.loads(content))

    def test_bad_json_and_cross_origin(self):
        status, _ = self.request("POST", "/api/evaluate", b"{", {"Content-Type":"application/json"})
        self.assertEqual(status, 400)
        status, _ = self.request("POST", "/api/evaluate", b"[]", {"Content-Type":"application/json", "Origin":"https://other.example"})
        self.assertEqual(status, 403)

    def test_private_files_not_served(self):
        for path in ["/.git/config", "/.env", "/simulator.py", "/../README.md"]:
            self.assertEqual(self.request("GET", path)[0], 404)

    def test_ai_endpoint_uses_real_adapter_with_mocked_provider(self):
        with patch("ai_analysis.load_config", return_value=CONFIG), patch("ai_analysis.call_provider", return_value=fixture_completion()) as provider:
            status, content = self.request("GET", "/api/ai/status")
            self.assertEqual(status, 200)
            self.assertNotIn(CONFIG.key, content.decode())
            status, content = self.request("POST", "/api/ai/analyze", (ROOT / "examples" / "organizer.json").read_bytes(), {"Content-Type": "application/json"})
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(content)["method"], "llm")
            self.assertEqual(provider.call_count, 1)
            self.assertNotIn(CONFIG.key, content.decode())

    def test_ai_unconfigured_invalid_and_cross_origin(self):
        headers = {"Content-Type": "application/json"}
        with patch("ai_analysis.load_config", side_effect=AIError("AI не настроен")), patch("ai_analysis.call_provider") as provider:
            status, content = self.request("GET", "/api/ai/status")
            self.assertFalse(json.loads(content)["configured"])
            self.assertEqual(self.request("POST", "/api/ai/analyze", b"[]", headers)[0], 422)
            example = (ROOT / "examples" / "organizer.json").read_bytes()
            status, content = self.request("POST", "/api/ai/analyze", example, headers)
            self.assertEqual(status, 503)
            self.assertIn("error", json.loads(content))
            self.assertEqual(self.request("POST", "/api/ai/analyze", example, {**headers, "Origin": "https://other.example"})[0], 403)
            provider.assert_not_called()
