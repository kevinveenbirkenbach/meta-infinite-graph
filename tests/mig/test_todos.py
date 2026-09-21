import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "mig"))

import todos  # noqa: E402

CORE = Path("/home/kevinveenbirkenbach/Repositories/github.com/kevinveenbirkenbach/infinito-nexus-core")

LINES = {
    ("grep", "HEAD"): [
        "HEAD:roles/web-app-x/tasks/main.yml:12:  # TODO: drop the workaround",
        "HEAD:utils/handler/ci.py:4:# FIXME(kevin): the mirror lags",
        "HEAD:roles/dev-npm/TODO.md:3:- [ ] pin the lockfile",
        "HEAD:broken line without numbers",
        "HEAD:roles/web-app-y/tasks/main.yml:9:  # TODO",
    ],
    ("ls-tree", "HEAD"): ["roles/dev-npm/TODO.md", "roles/web-app-x/tasks/main.yml"],
    ("show", "HEAD:roles/dev-npm/TODO.md"): [
        "# Open points",
        "",
        "- [ ] pin the lockfile",
        "* rewrite the install step",
    ],
}


def fake(args):
    if args[0] == "grep":
        return "\n".join(LINES[("grep", args[-2])])
    if args[0] == "ls-tree":
        return "\n".join(LINES[("ls-tree", args[-1])])
    return "\n".join(LINES[("show", args[-1])])


def test_markers_and_note_files_land_in_one_list():
    answer = todos.collect(fake, "HEAD")
    assert answer["ref"] == "HEAD"
    found = {(one["path"], one["line"]): one for one in answer["items"]}

    assert found[("roles/web-app-x/tasks/main.yml", 12)]["kind"] == "todo"
    assert found[("roles/web-app-x/tasks/main.yml", 12)]["text"] == "# TODO: drop the workaround"
    assert found[("utils/handler/ci.py", 4)]["kind"] == "fixme"
    assert found[("roles/dev-npm/TODO.md", 3)]["kind"] == "note"
    assert found[("roles/dev-npm/TODO.md", 3)]["text"] == "pin the lockfile", "the bullet is furniture"
    assert found[("roles/dev-npm/TODO.md", 4)]["text"] == "rewrite the install step", \
        "a TODO.md line counts even without a marker word"
    assert ("roles/dev-npm/TODO.md", 1) not in found, "a heading is not an item"
    assert found[("roles/web-app-y/tasks/main.yml", 9)]["text"] == "# TODO", "a bare marker still counts"
    assert len([one for one in answer["items"] if one["path"].endswith("TODO.md") and one["line"] == 3]) == 1, \
        "a marker line inside a TODO.md is listed once"
    assert answer["capped"] is False


def test_the_real_repository_answers_both_kinds():
    if not (CORE / ".git").exists():
        return

    def real(args):
        done = subprocess.run(["git", "-C", str(CORE), *args], capture_output=True, text=True, timeout=300)
        return done.stdout

    answer = todos.collect(real, "HEAD")
    kinds = {one["kind"] for one in answer["items"]}
    assert "todo" in kinds and "note" in kinds, f"only found {kinds}"
    assert len(answer["items"]) > 100
    assert all(one["text"] for one in answer["items"])
