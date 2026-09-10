"""Serves the local git mirror to the browser.

A mirror of the root repository plus one promisor remote per fork answers every
question the timeline used to spend GitHub requests on, and a worktree at a
chosen commit gives the tables the roles tree as it stood then.

Endpoints (all GET, all JSON):
  /catalog                     repos, refs, tags and the overall commit span
  /log?ref=&since=&until=      commits on one ref, newest first
  /checkout?at=&ref=           worktree at the newest commit before `at`
  /refresh                     fetch every remote again
"""

import json
import os
import shutil
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

ROOT = os.environ["MIG_GIT_ROOT"]
HOME = os.environ["MIG_GIT_HOME"]
MIRROR = os.path.join(HOME, "mirror.git")
TREES = os.path.join(HOME, "worktrees")
PORT = int(os.environ["MIG_GIT_PORT"])
KEEP = int(os.environ["MIG_GIT_KEEP"])
UNIT = "\x1f"


class Failed(Exception):
    pass


def git(*args, check=True):
    done = subprocess.run(
        ["git", "--git-dir", MIRROR, *args],
        capture_output=True, text=True, timeout=900,
    )
    if check and done.returncode != 0:
        raise Failed(done.stderr.strip() or f"git {' '.join(args)} failed")
    return done.stdout


def remotes():
    listed = {}
    for line in git("remote", "-v").splitlines():
        name, rest = line.split("\t", 1)
        listed[name] = rest.split(" ")[0]
    return listed


def refs_of(remote):
    # The mirrored root keeps its branches in refs/heads; every fork is a remote
    # and keeps them under refs/remotes. Asking the wrong one returns nothing.
    where = "refs/heads" if remote == "origin" else f"refs/remotes/{remote}"
    strip = 0 if remote == "origin" else len(remote) + 1
    out = git("for-each-ref", "--format=%(refname:short)" + UNIT + "%(objectname)"
              + UNIT + "%(committerdate:iso-strict)", where)
    found = []
    for line in out.splitlines():
        name, sha, date = line.split(UNIT)
        short = name[strip:]
        if not short or short == "HEAD":
            continue
        found.append({"name": short, "ref": name, "tip": sha, "date": date})
    return found


def tags():
    out = git("for-each-ref", "--format=%(refname:short)" + UNIT + "%(objectname)"
              + UNIT + "%(creatordate:iso-strict)", "refs/tags")
    listed = []
    for line in out.splitlines():
        name, sha, date = line.split(UNIT)
        listed.append({"name": name, "sha": sha, "date": date})
    return listed


def span():
    newest = git("log", "--all", "-1", "--format=%cI").strip()
    # --reverse would walk the whole graph before printing; sorting the roots is
    # the same answer for a fraction of the work.
    oldest = min(
        (line for line in git("log", "--all", "--max-parents=0", "--format=%cI").splitlines()),
        default=newest,
    )
    return {"from": oldest, "to": newest}


def catalog():
    listed = remotes()
    repos = []
    for name, url in sorted(listed.items()):
        repos.append({
            "remote": name,
            "url": url,
            "full_name": url.rstrip("/").removesuffix(".git").split("github.com/")[-1],
            "refs": refs_of(name),
        })
    return {"root": ROOT, "repos": repos, "tags": tags(), "span": span()}


def log(ref, since, until, limit):
    args = ["log", f"--format=%H{UNIT}%P{UNIT}%cI{UNIT}%s", f"--max-count={limit}"]
    if since:
        args.append(f"--since={since}")
    if until:
        args.append(f"--until={until}")
    args.append(ref)
    walked = []
    for line in git(*args).splitlines():
        sha, parents, date, message = line.split(UNIT, 3)
        walked.append({
            "sha": sha,
            "parents": parents.split() if parents else [],
            "date": date,
            "message": message,
        })
    return walked


def checkout(at, ref):
    found = git("rev-list", "-1", f"--before={at}", ref).strip() if at else git(
        "rev-parse", ref).strip()
    if not found:
        raise Failed(f"{ref} has no commit before {at}")
    where = os.path.join(TREES, found)
    if not os.path.isdir(where):
        os.makedirs(TREES, exist_ok=True)
        git("worktree", "add", "--detach", "--force", where, found)
        prune()
    date = git("log", "-1", "--format=%cI", found).strip()
    return {"sha": found, "date": date, "path": f"/at/{found}/"}


def prune():
    kept = sorted(
        (os.path.join(TREES, name) for name in os.listdir(TREES)),
        key=os.path.getmtime, reverse=True,
    )
    for stale in kept[KEEP:]:
        shutil.rmtree(stale, ignore_errors=True)
    git("worktree", "prune", check=False)


def refresh():
    listed = [name for name in remotes() if name != "origin"]
    git("fetch", "--prune", "origin", check=False)
    if listed:
        git("fetch", "--multiple", "--prune", "--no-tags", *listed, check=False)
    return catalog()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_):
        pass

    def do_GET(self):
        route = urlparse(self.path)
        query = {key: value[0] for key, value in parse_qs(route.query).items()}
        try:
            if route.path in ("/catalog", "/catalog/"):
                body = catalog()
            elif route.path == "/log":
                body = log(
                    query.get("ref", "origin/HEAD"),
                    query.get("since", ""),
                    query.get("until", ""),
                    min(int(query.get("limit", "20000")), 50000),
                )
            elif route.path == "/checkout":
                body = checkout(query.get("at", ""), query.get("ref", "origin/HEAD"))
            elif route.path == "/refresh":
                body = refresh()
            else:
                return self._answer(404, {"error": f"no route {route.path}"})
        except Failed as error:
            return self._answer(502, {"error": str(error)})
        except Exception as error:  # noqa: BLE001
            return self._answer(500, {"error": f"{type(error).__name__}: {error}"})
        return self._answer(200, body)

    def _answer(self, status, body):
        raw = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


def main():
    if not os.path.isdir(MIRROR):
        print(f"mig-git: no mirror at {MIRROR}", file=sys.stderr)
        return 1
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main())
