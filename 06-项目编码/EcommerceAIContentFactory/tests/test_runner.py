import importlib.util
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RUNNER_PATH = ROOT / "evals" / "runner.py"


def load_runner():
    spec = importlib.util.spec_from_file_location("harness_runner", RUNNER_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write(path: Path, text: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


class RunnerTests(unittest.TestCase):
    def test_collab_sections_are_read_as_utf8(self):
        runner = load_runner()
        with tempfile.TemporaryDirectory() as temp_dir:
            repo = Path(temp_dir)
            write(repo / "project-tracker.md", "# 项目\n\n## 七、决策日志\n\n## 八、AI 协作上下文\n")

            self.assertEqual(runner.check_collab_handoff(repo), [])
            self.assertEqual(runner.check_conflict_escalation(repo), [])

    def test_utf8_report_write_round_trips(self):
        runner = load_runner()
        with tempfile.TemporaryDirectory() as temp_dir:
            report = Path(temp_dir) / "reports" / "report.json"

            runner.write_text(report, '{"name": "跨角色上下文交接", "status": "通过"}')

            self.assertEqual(runner.read_text(report), '{"name": "跨角色上下文交接", "status": "通过"}')


if __name__ == "__main__":
    unittest.main()
