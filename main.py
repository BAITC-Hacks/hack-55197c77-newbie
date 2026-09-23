"""Command-line entry point. Python 3.10+, standard library only."""
import argparse
import json
from pathlib import Path
from simulator import baseline, evaluate
from conclusions import build_conclusion


def main():
    parser = argparse.ArgumentParser(description="Аким на 5 часов: расчёт городского сценария")
    parser.add_argument("scenario", nargs="?", type=Path, help="JSON-файл с пятью решениями")
    args = parser.parse_args()
    try:
        if args.scenario:
            decisions = json.loads(args.scenario.read_text(encoding="utf-8-sig"))
            result = evaluate(decisions)
            if result["valid"]:
                result["conclusion"] = build_conclusion(decisions, result)
        else:
            result = baseline()
    except (OSError, ValueError) as exc:
        parser.exit(2, f"Ошибка чтения сценария: {exc}\n")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("valid", True) else 2


if __name__ == "__main__":
    raise SystemExit(main())
