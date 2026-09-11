import importlib
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "mig"))


@pytest.fixture
def server(monkeypatch, tmp_path):
    for key, value in {
        "MIG_GIT_ROOT": "infinito-nexus/core",
        "MIG_GIT_HOME": str(tmp_path),
        "MIG_GIT_PORT": "0",
        "MIG_GIT_KEEP": "3",
    }.items():
        monkeypatch.setenv(key, value)
    module = importlib.import_module("git")
    monkeypatch.setattr(module, "ROOT", "infinito-nexus/core")
    monkeypatch.setattr(module, "remotes", lambda: {
        "origin": "https://github.com/infinito-nexus/core.git",
        "f1": "https://github.com/someone/core.git",
    })
    return module


def test_the_root_and_its_mirrored_forks_may_lend_the_token(server):
    assert server.mirrored("infinito-nexus/core") == "infinito-nexus/core"
    assert server.mirrored("someone/core") == "someone/core"


def test_a_stranger_never_gets_the_server_token(server):
    with pytest.raises(server.Failed, match="not a repository of this mirror"):
        server.mirrored("stranger/anything")
