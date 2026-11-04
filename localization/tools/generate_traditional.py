import argparse
import json
import re
from pathlib import Path

from opencc import OpenCC

ROOT = Path(__file__).resolve().parents[2]
CHINESE = re.compile(r"[\u3400-\u9fff]+")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    converter = OpenCC("s2twp")
    def convert(text):
        return converter.convert(text).replace("智慧體", "智能體")

    resources = list((ROOT / "localization").glob("*.json"))
    resources += list((ROOT / "localization/runtime").glob("*.js"))
    resources += [path for path in (ROOT / "internal/core").glob("*.go") if not path.name.endswith("_test.go")]
    resources += [ROOT / "app.go", ROOT / "frontend/dist/app.js", ROOT / "frontend/dist/index.html"]
    translations = {}
    frontend = {}
    for path in resources:
        for text in CHINESE.findall(path.read_text(encoding="utf-8")):
            translations[text] = convert(text)
            if "frontend" in path.parts or path.suffix == ".go":
                frontend[text] = translations[text]
    for translations_for_target in [translations, frontend]:
        characters = set("".join(translations_for_target))
        for character in characters:
            translations_for_target.setdefault(character, convert(character))
    outputs = {
        ROOT / "internal/core/traditional.json": json.dumps(translations, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
        ROOT / "frontend/dist/traditional.js": "window.cursorZhTraditional = " + json.dumps(frontend, ensure_ascii=False, sort_keys=True, indent=2) + ";\n",
    }
    for path, content in outputs.items():
        if args.check:
            if not path.exists() or path.read_text(encoding="utf-8") != content:
                raise SystemExit(f"Regenerate Traditional Chinese resources: {path.relative_to(ROOT)}")
        else:
            path.write_text(content, encoding="utf-8", newline="\n")
    print(f"Traditional Chinese resources: {len(translations)} entries")


if __name__ == "__main__":
    main()
