"""Downloads a workflow run's Playwright artifact once and says what it holds.

GitHub hands the zip only to a token, even for a public repository, and only
as a redirect to blob storage a browser may not read. So the server fetches it,
unpacks it under <home>/<id>/ for nginx to serve, and answers with the JUnit
results of every report inside.
"""

import json
import os
import re
import shutil
import tempfile
import threading
import urllib.error
import urllib.request
import xml.etree.ElementTree as ElementTree
import zipfile

API = "https://api.github.com"
PREFIX = "playwright-"
LIMIT = int(os.environ.get("MIG_ARTIFACT_LIMIT") or 2 * 1024 * 1024 * 1024)
# An artifact never changes once uploaded, so it stays until the disk budget
# runs out rather than until a count does: one deploy run alone uploads dozens.
BUDGET = int(os.environ.get("MIG_ARTIFACT_BUDGET") or 8 * 1024 * 1024 * 1024)
RESULTS = "results.json"
JUNIT = "playwright-junit.xml"
ATTACHMENT = re.compile(r"\[\[ATTACHMENT\|([^\]]+)\]\]")
GUARD = threading.Lock()
LOCKS = {}
# The report reads localStorage, which throws in the sandbox nginx serves it
# in and leaves a blank page; an in-memory stand-in lets it run without ever
# getting the page's origin, and so without the visitor's token.
SHIM = (
    '<script id="mig-storage-shim">(function () {'
    'function memory() { var data = {}; return {'
    'getItem: function (key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },'
    'setItem: function (key, value) { data[key] = String(value); },'
    'removeItem: function (key) { delete data[key]; },'
    'clear: function () { data = {}; },'
    'key: function (index) { return Object.keys(data)[index] || null; },'
    'get length() { return Object.keys(data).length; } }; }'
    '["localStorage", "sessionStorage"].forEach(function (name) {'
    'try { window[name].length; } catch (error) {'
    'Object.defineProperty(window, name, { value: memory(), configurable: true }); } });'
    '})();</script>'
)


def _lock(artifact_id):
    with GUARD:
        return LOCKS.setdefault(str(artifact_id), threading.Lock())


class Failed(Exception):
    pass


class _Stay(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_):
        return None


def _open(url, token="", follow=True, timeout=120):
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "meta-infinite-graph"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    opener = urllib.request.build_opener() if follow else urllib.request.build_opener(_Stay)
    return opener.open(urllib.request.Request(url, headers=headers), timeout=timeout)


def _meta(root, artifact_id, token):
    try:
        with _open(f"{API}/repos/{root}/actions/artifacts/{artifact_id}", token) as answer:
            return json.load(answer)
    except urllib.error.HTTPError as error:
        raise Failed(f"GitHub {error.code} for artifact {artifact_id}") from error


def _download(root, artifact_id, token, into):
    try:
        _open(f"{API}/repos/{root}/actions/artifacts/{artifact_id}/zip", token, follow=False)
        raise Failed("GitHub answered the artifact zip without a redirect")
    except urllib.error.HTTPError as error:
        if error.code not in (301, 302, 303, 307, 308):
            raise Failed(f"GitHub {error.code} for the zip of artifact {artifact_id}") from error
        location = error.headers["Location"]
    # The signed blob URL refuses a request that also carries the bearer token.
    written = 0
    with _open(location, timeout=300) as answer:
        while chunk := answer.read(1 << 20):
            written += len(chunk)
            if written > LIMIT:
                raise Failed(f"artifact {artifact_id} is larger than {LIMIT} bytes")
            into.write(chunk)


def _inside(base, candidate):
    base, candidate = os.path.realpath(base), os.path.realpath(candidate)
    return os.path.commonpath([base, candidate]) == base


def junit(path, base):
    """Args:
        path: a playwright-junit.xml inside the unpacked artifact.
        base: the artifact's root, which every returned path is relative to.
    Returns: [{name, status, time, message, attachments}], one per test case.
    """
    folder = os.path.dirname(path)
    tests = []
    for case in ElementTree.parse(path).iter("testcase"):
        failure = case.find("failure")
        if failure is None:
            failure = case.find("error")
        skipped = case.find("skipped") is not None
        attachments = []
        for node in case.iter("system-out"):
            for raw in ATTACHMENT.findall(node.text or ""):
                # Recorded inside the container, where /reports is the folder
                # that later became this report's own directory.
                relative = raw.strip().split("/reports/", 1)[-1].lstrip("/")
                candidate = os.path.normpath(os.path.join(folder, relative))
                if _inside(base, candidate) and os.path.isfile(candidate):
                    attachments.append(os.path.relpath(candidate, base))
        message = ""
        if failure is not None:
            message = failure.get("message") or (failure.text or "")
        tests.append({
            "name": case.get("name", ""),
            "status": "failed" if failure is not None else "skipped" if skipped else "passed",
            "time": float(case.get("time") or 0),
            "message": message.strip()[:500],
            "attachments": attachments,
        })
    return tests


def reports(base):
    """Returns: one entry per report, from its path
    <distro>/<apps>/<application_id>/variant-<n>/<sync|async>/.
    """
    found = []
    for folder, _, files in os.walk(base):
        if JUNIT not in files:
            continue
        relative = os.path.relpath(folder, base)
        parts = relative.split(os.sep)
        variant = parts[-2] if len(parts) >= 2 else ""
        html = os.path.join(relative, "playwright-report", "index.html")
        videos = [
            os.path.relpath(os.path.join(where, name), base)
            for where, _, names in os.walk(os.path.join(folder, "test-results"))
            for name in names if name.endswith(".webm")
        ]
        found.append({
            "app": parts[-3] if len(parts) >= 3 else "",
            "variant": int(variant[8:]) if re.fullmatch(r"variant-\d+", variant) else None,
            "phase": parts[-1],
            "report": html if os.path.isfile(os.path.join(base, html)) else None,
            "videos": sorted(videos),
            "tests": junit(os.path.join(folder, JUNIT), base),
        })
    return sorted(found, key=lambda one: (one["app"], one["variant"] or 0, one["phase"]))


def _shim(where, results):
    for report in results["reports"]:
        if not report["report"]:
            continue
        path = os.path.join(where, report["report"])
        with open(path, encoding="utf-8") as page:
            html = page.read()
        if 'id="mig-storage-shim"' in html:
            continue
        head = html.find("<head>")
        html = html[:head + 6] + SHIM + html[head + 6:] if head >= 0 else SHIM + html
        with open(path, "w", encoding="utf-8") as page:
            page.write(html)


def _readable(root):
    """Opens the unpacked tree to nginx, whose worker is not the user that wrote
    it: mkdtemp() makes the root 0700, and a zip may carry modes of its own."""
    os.chmod(root, 0o755)
    for folder, folders, files in os.walk(root):
        for name in folders:
            os.chmod(os.path.join(folder, name), 0o755)
        for name in files:
            os.chmod(os.path.join(folder, name), 0o644)


def _bytes(folder):
    try:
        with open(os.path.join(folder, RESULTS), encoding="utf-8") as cached:
            return json.load(cached).get("bytes", 0)
    except (OSError, ValueError):
        return 0


def prune(home):
    """Drops the least recently read artifacts until the rest fit BUDGET; the
    newest one always stays."""
    with GUARD:
        kept = sorted(
            (os.path.join(home, name) for name in os.listdir(home) if name.isdigit()),
            key=os.path.getmtime, reverse=True,
        )
        total = 0
        for index, folder in enumerate(kept):
            total += _bytes(folder)
            if index and total > BUDGET:
                shutil.rmtree(folder, ignore_errors=True)


def fetch(root, artifact_id, token, home):
    """Args:
        root: owner/name the artifact must belong to.
        artifact_id: the artifact's numeric id.
        token: the server's GitHub token; the zip is refused without one.
        home: where unpacked artifacts are kept, one folder per id.
    Returns: {id, name, reports}, from the cache when it was fetched before.
    """
    where = os.path.join(home, str(int(artifact_id)))
    done = os.path.join(where, RESULTS)
    with _lock(artifact_id):
        if os.path.isfile(done):
            os.utime(where)
            os.chmod(where, 0o755)
            with open(done, encoding="utf-8") as cached:
                results = json.load(cached)
            _shim(where, results)
            return results
        if not token:
            raise Failed("downloading an artifact needs MIG_GITHUB_TOKEN on the server")
        meta = _meta(root, artifact_id, token)
        name = meta.get("name", "")
        if not name.startswith(PREFIX):
            raise Failed(f"{name or artifact_id} is not a Playwright artifact")
        if meta.get("expired"):
            raise Failed(f"GitHub has expired {name}")
        if meta.get("size_in_bytes", 0) > LIMIT:
            raise Failed(f"{name} is larger than {LIMIT} bytes")
        os.makedirs(home, exist_ok=True)
        staging = tempfile.mkdtemp(dir=home, prefix=".staging-")
        try:
            with tempfile.TemporaryFile() as archive:
                _download(root, artifact_id, token, archive)
                with zipfile.ZipFile(archive) as bundle:
                    unpacked = sum(entry.file_size for entry in bundle.infolist())
                    if unpacked > 4 * LIMIT:
                        raise Failed(f"{name} unpacks to more than {4 * LIMIT} bytes")
                    bundle.extractall(staging)
            results = {"id": int(artifact_id), "name": name, "bytes": unpacked, "reports": reports(staging)}
            with open(os.path.join(staging, RESULTS), "w", encoding="utf-8") as out:
                json.dump(results, out)
            _shim(staging, results)
            _readable(staging)
            shutil.rmtree(where, ignore_errors=True)
            os.replace(staging, where)
        except BaseException:
            shutil.rmtree(staging, ignore_errors=True)
            raise
        prune(home)
        return results
