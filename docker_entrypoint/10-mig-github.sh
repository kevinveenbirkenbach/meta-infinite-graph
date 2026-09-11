#!/bin/sh
set -eu

# Param: MIG_GITHUB_TOKEN the server token the /gh/ proxy adds; empty for none.
# Param: MIG_GITHUB_ALERTS exactly "true" to forward Dependabot, code scanning
#   and secret scanning alerts; anything else keeps them off.

CONF=/etc/nginx/mig-github.conf
REPO='repos/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+'

if [ -n "${MIG_GITHUB_TOKEN:-}" ]; then
  PROXY=true
  AUTH="    proxy_set_header Authorization \"Bearer ${MIG_GITHUB_TOKEN}\";"
else
  PROXY=false
  AUTH="    proxy_set_header Authorization \"\";"
fi

# Args: $1 the path regex after /gh/, $2 the query sent upstream in place of
# the visitor's, so no visitor can ask the server token for drafts or secrets.
fixed() {
  cat <<LOCATION
  location ~ "^/gh/($1)\$" {
    resolver 127.0.0.11 1.1.1.1 valid=300s ipv6=off;
    set \$mig_upstream https://api.github.com/\$1?$2;
    proxy_pass \$mig_upstream;
    proxy_ssl_server_name on;
    proxy_set_header Host api.github.com;
    proxy_set_header Accept "application/vnd.github+json";
    proxy_set_header User-Agent "meta-infinite-graph";
${AUTH}
    proxy_set_header Cookie "";
    add_header Cache-Control "no-store";
  }
LOCATION
}

# Alerts are the token owner's private findings; forwarding them shows every
# visitor of this instance what only the owner may see.
if [ "${MIG_GITHUB_ALERTS:-}" = true ]; then
  ALERTS=true
  ALERT_LOCATIONS="$(fixed "$REPO/(dependabot|code-scanning)/alerts" 'state=open&per_page=100')
$(fixed "$REPO/secret-scanning/alerts" 'state=open&hide_secret=true&per_page=100')"
else
  ALERTS=false
  ALERT_LOCATIONS=''
fi

# Widening this path list turns the instance into an open GitHub proxy that
# spends the server token on a stranger's calls. The /repositories/<id> form is
# not a second surface: it is the shape GitHub's own Link header uses for the
# next page, so without it every paginated answer stops at page one.
cat > "$CONF" <<CONFIG
  location = /gh-config.json {
    default_type application/json;
    add_header Cache-Control "no-store";
    return 200 '{"proxy":${PROXY},"alerts":${ALERTS}}';
  }

$(fixed "$REPO/security-advisories" 'state=published&per_page=100')
${ALERT_LOCATIONS}

  location ~ "^/gh/((repos/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+|repositories/[0-9]+)(/(forks|branches|tags|commits|pulls)(/[0-9a-fA-F]{7,40})?|/actions/runs)?)\$" {
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

echo "mig: github proxy enabled=${PROXY} alerts=${ALERTS}"
