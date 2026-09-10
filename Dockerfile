FROM nginx:alpine

RUN apk add --no-cache git python3

ENV MIG_GIT_PORT=8399

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.d/10-mig-github.sh /docker-entrypoint.d/10-mig-github.sh
COPY docker-entrypoint.d/20-mig-git.sh /docker-entrypoint.d/20-mig-git.sh
COPY mig-git.py /usr/local/bin/mig-git.py
COPY src/ /usr/share/nginx/html/

RUN chmod +x /docker-entrypoint.d/10-mig-github.sh /docker-entrypoint.d/20-mig-git.sh \
 && : > /etc/nginx/mig-github.conf \
 && : > /etc/nginx/mig-git.conf \
 && mkdir -p /var/lib/mig/worktrees

EXPOSE 80
