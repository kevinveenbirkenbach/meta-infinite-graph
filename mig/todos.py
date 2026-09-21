"""What the repository still owes itself, read out of the mirror.

The browser cannot walk a repository file by file, so `git grep` answers the
markers in the code and the lines of every TODO.md at once, on any ref the
mirror carries.
"""

import re

MARKER = re.compile(r"\b(TODO|FIXME|XXX|HACK)\b[:( ]?", re.IGNORECASE)
NOTES = "TODO.md"
LIMIT = 2000
BULLET = re.compile(r"^\s*(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s*)?")


def _clean(text):
    return BULLET.sub("", text).strip()


def _kind(path, text):
    if path.endswith(NOTES):
        return "note"
    found = MARKER.search(text)
    return (found.group(1).lower() if found else "todo")


# Args:
#   grep: (args) -> the lines `git grep` wrote, so the caller decides which
#     ref is read and how git is reached.
#   ref: the ref to read, as the caller names it.
# Returns: {ref, items: [{path, line, kind, text}], capped}
def collect(grep, ref):
    items = []
    for raw in grep(["grep", "-nI", "-E", r"\b(TODO|FIXME|XXX|HACK)\b", ref, "--"]).splitlines():
        # <ref>:<path>:<line>:<text>, and a path may hold colons of its own.
        rest = raw.split(":", 1)[1] if raw.startswith(f"{ref}:") else raw
        parts = rest.split(":", 2)
        if len(parts) != 3 or not parts[1].isdigit():
            continue
        path, line, text = parts[0], int(parts[1]), _clean(parts[2])
        if not text:
            continue
        items.append({"path": path, "line": line, "kind": _kind(path, text), "text": text[:300]})
    for path in grep(["ls-tree", "-r", "--name-only", ref]).splitlines():
        if not path.endswith(NOTES):
            continue
        for number, raw in enumerate(grep(["show", f"{ref}:{path}"]).splitlines(), 1):
            text = _clean(raw)
            if not text or text.startswith("#") or any(
                one["path"] == path and one["line"] == number for one in items
            ):
                continue
            items.append({"path": path, "line": number, "kind": "note", "text": text[:300]})
    items.sort(key=lambda one: (one["path"], one["line"]))
    return {"ref": ref, "items": items[:LIMIT], "capped": len(items) > LIMIT}
