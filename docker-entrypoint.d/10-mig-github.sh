#!/bin/sh
set -eu

CONF=/etc/nginx/mig-github.conf

if [ -n "${MIG_GITHUB_TOKEN:-}" ]; then
  PROXY=true
  AUTH="    proxy_set_header Authorization \"Bearer ${MIG_GITHUB_TOKEN}\";"
else
  PROXY=false
  AUTH="    proxy_set_header Authorization \"\";"
fi

# Widening this path list turns the instance into an open GitHub proxy that
# spends the server token on a stranger's calls. The /repositories/<id> form is
# not a second surface: it is the shape GitHub's own Link header uses for the
# next page, so without it every paginated answer stops at page one.
cat > "$CONF" <<CONFIG
  location = /gh-config.json {
    default_type application/json;
    add_header Cache-Control "no-store";
    return 200 '{"proxy":${PROXY}}';
  }

  location ~ "^/gh/((repos/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+|repositories/[0-9]+)(/(forks|branches|tags|commits))?)\$" {
    resolver 127.0.0.11 1.1.1.1 valid=300s ipv6=off;
    set \$mig_upstream https://api.github.com/\$1\$is_args\$args;
    proxy_pass \$mig_upstream;
    proxy_ssl_server_name on;
    proxy_set_header Host api.github.com;
    proxy_set_header Accept "application/vnd.github+json";
    proxy_set_header User-Agent "meta-infinite-graph";
${AUTH}
    proxy_set_header Cookie "";
    add_header Cache-Control "no-store";
  }

  location /gh/ {
    return 404;
  }
CONFIG

echo "mig: github proxy enabled=${PROXY}"
