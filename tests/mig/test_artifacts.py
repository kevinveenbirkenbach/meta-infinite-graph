import io
import sys
import urllib.error
import zipfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "mig"))

import artifacts  # noqa: E402

REPORT = "debian/web-app-nextcloud/web-app-nextcloud/variant-1/sync"

JUNIT = """<?xml version="1.0"?>
<testsuites>
  <testsuite name="playwright.spec.js">
    <testcase name="admin: nextcloud oidc login and logout" classname="playwright.spec.js" time="12.5">
      <failure message="expected 200, got 502">stack</failure>
      <system-out>
[[ATTACHMENT|test-results/login-admin/video.webm]]
[[ATTACHMENT|/reports/test-results/login-admin/trace.zip]]
[[ATTACHMENT|../../../../../../etc/passwd]]
</system-out>
    </testcase>
    <testcase name="user: files load" classname="playwright.spec.js" time="3"/>
    <testcase name="talk: call starts" classname="playwright.spec.js" time="0"><skipped/></testcase>
  </testsuite>
</testsuites>
"""


def bundle():
    raw = io.BytesIO()
    with zipfile.ZipFile(raw, "w") as archive:
        archive.writestr(f"{REPORT}/playwright-junit.xml", JUNIT)
        archive.writestr(f"{REPORT}/playwright-report/index.html", "<html><head></head><body></body></html>")
        archive.writestr(f"{REPORT}/test-results/login-admin/video.webm", b"webm")
        archive.writestr(f"{REPORT}/test-results/login-admin/trace.zip", b"zip")
    return raw.getvalue()


@pytest.fixture
def github(monkeypatch):
    calls = []

    def meta(root, artifact_id, token):
        calls.append(("meta", root, artifact_id))
        return {"name": f"playwright-compose-web-app-nextcloud-1-debian-{artifact_id}", "size_in_bytes": 10}

    def download(root, artifact_id, token, into):
        calls.append(("zip", root, artifact_id))
        into.write(bundle())

    monkeypatch.setattr(artifacts, "_meta", meta)
    monkeypatch.setattr(artifacts, "_download", download)
    return calls


def test_an_artifact_is_unpacked_parsed_and_then_answered_from_disk(github, tmp_path):
    first = artifacts.fetch("infinito-nexus/core", "7", "token", str(tmp_path))
    second = artifacts.fetch("infinito-nexus/core", "7", "token", str(tmp_path))

    assert second == first
    assert [call[0] for call in github] == ["meta", "zip"], "the second visit reads the cache"
    [report] = first["reports"]
    assert (report["app"], report["variant"], report["phase"]) == ("web-app-nextcloud", 1, "sync")
    assert report["report"] == f"{REPORT}/playwright-report/index.html"
    assert report["videos"] == [f"{REPORT}/test-results/login-admin/video.webm"]
    failed, passed, skipped = report["tests"]
    assert (failed["status"], failed["message"]) == ("failed", "expected 200, got 502")
    assert failed["attachments"] == [
        f"{REPORT}/test-results/login-admin/video.webm",
        f"{REPORT}/test-results/login-admin/trace.zip",
    ], "a relative and a /reports path resolve; one leaving the artifact is dropped"
    assert (passed["status"], skipped["status"]) == ("passed", "skipped")
    video = tmp_path / "7" / REPORT / "test-results/login-admin/video.webm"
    assert video.is_file()
    assert (tmp_path / "7").stat().st_mode & 0o777 == 0o755, "nginx runs as another user and must enter the tree"
    assert video.stat().st_mode & 0o777 == 0o644


def test_the_report_gets_a_storage_stand_in_once_even_when_it_was_cached_without(github, tmp_path):
    artifacts.fetch("infinito-nexus/core", "7", "token", str(tmp_path))
    page = tmp_path / "7" / REPORT / "playwright-report/index.html"
    assert page.read_text(encoding="utf-8").count('id="mig-storage-shim"') == 1
    assert page.read_text(encoding="utf-8").startswith("<html><head><script"), "it runs before the report's own script"

    page.write_text("<html><head></head></html>", encoding="utf-8")
    artifacts.fetch("infinito-nexus/core", "7", "token", str(tmp_path))
    artifacts.fetch("infinito-nexus/core", "7", "token", str(tmp_path))
    assert page.read_text(encoding="utf-8").count('id="mig-storage-shim"') == 1


def test_a_cached_tree_left_closed_by_an_older_server_is_opened_on_the_next_read(github, tmp_path):
    artifacts.fetch("infinito-nexus/core", "7", "token", str(tmp_path))
    (tmp_path / "7").chmod(0o700)
    artifacts.fetch("infinito-nexus/core", "7", "token", str(tmp_path))
    assert (tmp_path / "7").stat().st_mode & 0o777 == 0o755


def test_no_token_no_download(github, tmp_path):
    with pytest.raises(artifacts.Failed, match="MIG_GITHUB_TOKEN"):
        artifacts.fetch("infinito-nexus/core", "7", "", str(tmp_path))
    assert github == []


def test_only_playwright_artifacts_are_fetched(monkeypatch, tmp_path):
    monkeypatch.setattr(artifacts, "_meta", lambda *_: {"name": "inventory-compose-x", "size_in_bytes": 1})
    with pytest.raises(artifacts.Failed, match="not a Playwright artifact"):
        artifacts.fetch("infinito-nexus/core", "8", "token", str(tmp_path))
    assert not (tmp_path / "8").exists()


def test_the_zip_follows_its_redirect_without_the_token(monkeypatch):
    seen = []

    def fake_open(url, token="", follow=True, timeout=120):
        seen.append((url, token, follow))
        if not follow:
            raise urllib.error.HTTPError(url, 302, "Found", {"Location": "https://blob.example/zip?sig=x"}, None)
        return io.BytesIO(b"zipbytes")

    monkeypatch.setattr(artifacts, "_open", fake_open)
    out = io.BytesIO()
    artifacts._download("infinito-nexus/core", 5, "secret", out)
    assert out.getvalue() == b"zipbytes"
    assert seen == [
        ("https://api.github.com/repos/infinito-nexus/core/actions/artifacts/5/zip", "secret", False),
        ("https://blob.example/zip?sig=x", "", True),
    ], "the signed blob URL never sees the bearer token"


def test_the_least_recently_read_artifacts_leave_once_the_budget_is_spent(github, tmp_path, monkeypatch):
    size = artifacts.fetch("infinito-nexus/core", "1", "token", str(tmp_path))["bytes"]
    assert size > 0
    monkeypatch.setattr(artifacts, "BUDGET", 2 * size)
    artifacts.fetch("infinito-nexus/core", "2", "token", str(tmp_path))
    artifacts.fetch("infinito-nexus/core", "1", "token", str(tmp_path))
    artifacts.fetch("infinito-nexus/core", "3", "token", str(tmp_path))
    assert sorted(path.name for path in tmp_path.iterdir()) == ["1", "3"], "2 was read longest ago"
    assert [call[2] for call in github if call[0] == "zip"] == ["1", "2", "3"], "a cached one is never fetched again"
