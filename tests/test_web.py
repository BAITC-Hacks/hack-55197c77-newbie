import http.client
import json
import threading
import unittest
from http.server import ThreadingHTTPServer

from web_server import Handler, ROOT


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
        for path in ["/", "/app.css", "/app.js"]:
            self.assertEqual(self.request("GET", path)[0], 200)

    def test_calculate_and_reject_invalid(self):
        example = (ROOT / "examples" / "organizer.json").read_bytes()
        headers = {"Content-Type": "application/json"}
        status, content = self.request("POST", "/api/evaluate", example, headers)
        self.assertEqual(status, 200)
        self.assertAlmostEqual(json.loads(content)["score"], 56.54307)
        status, content = self.request("POST", "/api/evaluate", b"[]", headers)
        self.assertEqual(status, 422)
        self.assertIsNone(json.loads(content)["score"])

    def test_bad_json_and_cross_origin(self):
        status, _ = self.request("POST", "/api/evaluate", b"{", {"Content-Type":"application/json"})
        self.assertEqual(status, 400)
        status, _ = self.request("POST", "/api/evaluate", b"[]", {"Content-Type":"application/json", "Origin":"https://other.example"})
        self.assertEqual(status, 403)

    def test_private_files_not_served(self):
        for path in ["/.git/config", "/.env", "/simulator.py", "/../README.md"]:
            self.assertEqual(self.request("GET", path)[0], 404)
