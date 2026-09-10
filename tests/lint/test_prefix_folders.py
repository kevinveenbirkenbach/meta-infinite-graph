import re
import subprocess
from collections import defaultdict
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[2]
MARKER = b"nocheck: prefix-folder"
EXEMPT_FILE = ".nocheck"
FOLDER_NAME = re.compile(r"^[a-z_]+$")
SEPARATOR = re.compile(r"[-_.]|(?<=[a-z0-9])(?=[A-Z])")


def prefix(name):
    return next(token for token in SEPARATOR.split(name) if token).lower()


# Returns: what git tracks or would track, as it stands on disk; untracked
#   files count so a move is checked before it is staged.
def tracked():
    listed = subprocess.run(
        ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        cwd=ROOT, capture_output=True, check=True,
    ).stdout.decode()
    return sorted({
        PurePosixPath(path) for path in listed.split("\0") if path and (ROOT / path).exists()
    })


def marked(path):
    file = ROOT / path
    return file.is_file() and MARKER in file.read_bytes()


def exempt_dirs(files):
    return {path.parent for path in files if path.name == EXEMPT_FILE}


def bad_folders(files):
    exempt = exempt_dirs(files)
    folders = {parent for path in files for parent in path.parents if parent.name}
    return sorted(
        str(folder)
        for folder in folders
        if not FOLDER_NAME.match(folder.name) and folder not in exempt
    )


def checked(files, is_marked):
    exempt = exempt_dirs(files)
    return [
        path for path in files
        if path.name != EXEMPT_FILE and path.parent not in exempt and not is_marked(path)
    ]


# Returns: {"<folder>/<prefix>/": [names]} for every group of two or more
#   files that share a prefix outside a folder of that name.
def stray_groups(files, is_marked):
    groups = defaultdict(list)
    for path in checked(files, is_marked):
        groups[(path.parent, prefix(path.name))].append(path.name)
    return {
        f"{folder / key}/": sorted(names)
        for (folder, key), names in sorted(groups.items())
        if len(names) > 1 and folder.name != key
    }


def redundant_prefixes(files, is_marked):
    return [
        str(path) for path in checked(files, is_marked)
        if path.parent.name and prefix(path.name) == path.parent.name
    ]


def test_prefix_splits_on_case_underscores_dashes_and_dots():
    assert prefix("matrixModel.js") == "matrix"
    assert prefix("matrix-view-edit.spec.js") == "matrix"
    assert prefix("role_info.py") == "role"
    assert prefix("README.md") == "readme"
    assert prefix(".gitignore") == "gitignore"
    assert prefix("__init__.py") == "init"


def test_rules_on_a_synthetic_tree():
    files = [PurePosixPath(p) for p in (
        "src/forkTree.js", "src/forkPlot.js", "src/app.js",
        "src/matrix/matrixModel.js", "src/matrix/table.js", "src/matrix/view.js",
        "src/vendor/.nocheck", "src/vendor/bootstrap.min.css", "src/vendor/bootstrap.bundle.min.js",
        "src/vendor/simple-icons/git.svg",
        "src/vendor/fonts/fa-solid.woff2", "src/vendor/fonts/fa-brands.woff2",
        "tests/e2e/test_http.sh", "lib/packageA.json", "lib/packageB.json",
    )]
    assert stray_groups(files, lambda path: path.name == "packageB.json") == {
        "src/fork/": ["forkPlot.js", "forkTree.js"],
        "src/vendor/fonts/fa/": ["fa-brands.woff2", "fa-solid.woff2"],
    }
    assert bad_folders(files) == ["src/vendor/simple-icons", "tests/e2e"]
    assert redundant_prefixes(files, lambda path: False) == ["src/matrix/matrixModel.js"]


def test_folder_names_are_lowercase_letters_and_underscores():
    offenders = bad_folders(tracked())
    assert not offenders, (
        "Folder names may only hold lowercase letters and underscores. Rename, or "
        f"put a tracked {EXEMPT_FILE} into the folder:\n  " + "\n  ".join(offenders)
    )


def test_files_sharing_a_prefix_live_in_a_folder_of_that_name():
    groups = stray_groups(tracked(), marked)
    assert not groups, (
        "Two or more files share a name prefix; move them into a folder named after "
        f"it, put a tracked {EXEMPT_FILE} into their folder, or add "
        f"'{MARKER.decode()}' to a file to leave it out:\n  "
        + "\n  ".join(f"{target}  <- {', '.join(names)}" for target, names in groups.items())
    )


def test_no_file_repeats_its_folder_name_as_prefix():
    offenders = redundant_prefixes(tracked(), marked)
    assert not offenders, (
        "The folder already names the prefix; drop it from the file name, e.g. "
        "src/role/roleInfo.js -> src/role/info.js:\n  " + "\n  ".join(offenders)
    )
