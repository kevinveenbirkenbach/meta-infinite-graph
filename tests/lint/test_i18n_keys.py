import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "src"
ENGLISH = json.loads((SRC / "locales" / "en.json").read_text())
LITERAL = re.compile(r"""\bt\(\s*'([\w.-]+)'""")
TERNARY = re.compile(r"""\bt\([^()]*\?\s*'([\w.-]+)'\s*:\s*'([\w.-]+)'""")
TEMPLATE = re.compile(r"""\bt\(\s*`([\w.-]+)\$\{""")
MARKUP = re.compile(r"""data-i18n(?:-title|-placeholder)?="([\w.-]+)\"""")
QUOTED = re.compile(r"""'([\w.-]+)'""")


def sources():
    for path in sorted(SRC.rglob("*")):
        if path.suffix in {".js", ".html"} and not {"vendor", "roles", "infinito_meta"} & set(path.parts):
            yield path.relative_to(ROOT), path.read_text()


def used():
    literal, prefixes = {}, {}
    for path, text in sources():
        for key in LITERAL.findall(text) + MARKUP.findall(text):
            literal.setdefault(key, str(path))
        for pair in TERNARY.findall(text):
            for key in pair:
                literal.setdefault(key, str(path))
        for prefix in TEMPLATE.findall(text):
            prefixes.setdefault(prefix, str(path))
    return literal, prefixes


def test_every_key_the_code_asks_for_is_in_the_english_catalogue():
    literal, prefixes = used()
    missing = sorted(f"{key} ({path})" for key, path in literal.items() if key not in ENGLISH)
    dangling = sorted(f"{prefix}… ({path})" for prefix, path in prefixes.items()
                      if not any(key.startswith(prefix) for key in ENGLISH))
    assert not missing and not dangling, (
        "src asks for keys src/locales/en.json does not define:\n  " + "\n  ".join(missing + dangling)
    )


def test_every_english_key_is_used_somewhere():
    literal, prefixes = used()
    quoted = {key for _, text in sources() for key in QUOTED.findall(text)}
    unused = sorted(key for key in ENGLISH if key not in literal and key not in quoted
                    and not any(key.startswith(p) for p in prefixes))
    assert not unused, "src/locales/en.json carries keys nothing reads:\n  " + "\n  ".join(unused)
