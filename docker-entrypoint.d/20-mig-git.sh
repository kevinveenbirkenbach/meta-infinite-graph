#!/bin/sh
# Param: MIG_GIT_ROOT     owner/name of the root repository
# Param: MIG_GIT_HOME     where the mirror and the worktrees live
# Param: MIG_GIT_FORKS    "auto" to discover forks through the API, "off" for
#                         the root alone, or a space separated owner/name list
# Param: MIG_GITHUB_TOKEN used for the one fork listing call, and for cloning
# Param: MIG_GIT_PORT     where mig-git.py listens and nginx proxies /git/ to
set -eu

ROOT="${MIG_GIT_ROOT:?set in .env}"
HOME_DIR="${MIG_GIT_HOME:?set in .env}"
MIRROR="$HOME_DIR/mirror.git"
FORKS="${MIG_GIT_FORKS:?set in .env}"

cat > /etc/nginx/mig-git.conf <<CONFIG
  location /git/ {
    proxy_pass http://127.0.0.1:${MIG_GIT_PORT}/;
    proxy_read_timeout 900s;
    add_header Cache-Control "no-store";
  }

  location /at/ {
    alias ${HOME_DIR}/worktrees/;
    autoindex on;
    autoindex_format json;
    add_header Cache-Control "no-store";
  }
CONFIG

mkdir -p "$HOME_DIR/worktrees"

# Backgrounded, clone included: nginx only starts once this script returns, so
# any network call made here in the foreground holds the whole page back.
(
  if [ ! -d "$MIRROR" ]; then
    echo "mig-git: cloning $ROOT"
    git clone --bare --filter=blob:none "https://github.com/$ROOT.git" "$MIRROR"
    git --git-dir "$MIRROR" config remote.origin.promisor true
    git --git-dir "$MIRROR" config remote.origin.partialclonefilter blob:none
  fi

  listed=""
  case "$FORKS" in
    off) ;;
    auto)
      auth=""
      [ -n "${MIG_GITHUB_TOKEN:-}" ] && auth="--header=Authorization: Bearer $MIG_GITHUB_TOKEN"
      listed=$(wget -T 30 -qO- ${auth:+"$auth"} \
        "https://api.github.com/repos/$ROOT/forks?per_page=100&sort=oldest" 2>/dev/null \
        | sed -n 's/.*"full_name": *"\([^"]*\)".*/\1/p' | grep -v "^$ROOT$" || true)
      ;;
    *) listed="$FORKS" ;;
  esac

  index=0
  for fork in $listed; do
    index=$((index + 1))
    name="f$index"
    git --git-dir "$MIRROR" remote add "$name" "https://github.com/$fork.git" 2>/dev/null || \
      git --git-dir "$MIRROR" remote set-url "$name" "https://github.com/$fork.git"
    git --git-dir "$MIRROR" config "remote.$name.promisor" true
    git --git-dir "$MIRROR" config "remote.$name.partialclonefilter" blob:none
  done
  echo "mig-git: $(echo "$listed" | grep -c . || true) forks registered"

  git --git-dir "$MIRROR" fetch --prune origin >/dev/null 2>&1 || true
  remotes=$(git --git-dir "$MIRROR" remote | grep -v '^origin$' || true)
  [ -n "$remotes" ] && git --git-dir "$MIRROR" fetch --multiple --prune --no-tags $remotes >/dev/null 2>&1
  echo "mig-git: mirror up to date"
) &

python3 /usr/local/bin/mig-git.py &
