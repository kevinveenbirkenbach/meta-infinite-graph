SHELL := /usr/bin/env bash

-include .env

COMPOSE_FILE ?= compose.yml
BASE_URL ?= http://127.0.0.1:$(MIG_PORT)
SERVICE ?= meta-infinite-graph

IMAGE ?= meta-infinite-graph:local
# Param: MIG_CHROMIUM  path to a chromium binary, for hosts where playwright
#   cannot install its own. Empty means playwright uses its bundled browser.
MIG_CHROMIUM ?=
# Param: LIBRETRANSLATE_URL  the LibreTranslate server make translate asks;
#   LIBRETRANSLATE_API_KEY in the environment is sent along when set.
LIBRETRANSLATE_URL ?= http://127.0.0.1:5000

.PHONY: help up down logs rebuild e2e vendor test test-fast lint translate image nginx-verify nginx-probe gh-status git-status clean

help:
	@echo "Targets:"
	@echo "  make up                  Start stack (config from .env, generated from default.env)"
	@echo "  make down                Stop stack"
	@echo "  make logs                Follow service logs"
	@echo "  make rebuild             Down + up"
	@echo "  make e2e                 Start stack, run HTTP E2E checks, stop stack"
	@echo "  make vendor              Copy the pinned npm libraries into src/vendor"
	@echo "  make test                Install browsers, then run the Playwright suite"
	@echo "  make test-fast           Run the Playwright suite without installing"
	@echo "  make lint                Run the repository lints under tests/lint and the type check"
	@echo "  make translate           Fill every missing catalogue entry through LibreTranslate"
	@echo "  make image               Build the container image"
	@echo "  make nginx-verify        Check the generated GitHub proxy config, with and without a token"
	@echo "  make nginx-probe         Serve the image and probe the proxy routes"
	@echo "  make gh-status           Report what the RUNNING stack does with the GitHub token"
	@echo "  make git-status          Report the RUNNING stack's git mirror and its service"
	@echo "  make clean               Down + remove volumes"

.env:
	cp default.env .env

up: .env vendor
	docker compose -f $(COMPOSE_FILE) up -d --build --force-recreate

down:
	docker compose -f $(COMPOSE_FILE) down --remove-orphans

logs:
	docker compose -f $(COMPOSE_FILE) logs -f $(SERVICE)

rebuild: down up

e2e: .env vendor
	@set -euo pipefail; \
	trap 'docker compose -f $(COMPOSE_FILE) down --remove-orphans' EXIT; \
	docker compose -f $(COMPOSE_FILE) up -d --build --force-recreate; \
	BASE_URL=$(BASE_URL) tests/end_to_end/test_http.sh

node_modules: package.json package-lock.json
	npm install --no-audit --no-fund
	touch node_modules

vendor: node_modules
	node scripts/vendor.js

test: vendor
	npx playwright install chromium
	MIG_CHROMIUM=$(MIG_CHROMIUM) npx playwright test

test-fast: vendor
	MIG_CHROMIUM=$(MIG_CHROMIUM) npx playwright test $(ARGS)

lint: node_modules
	python3 -m pytest -q tests/lint
	npx tsc -p tsconfig.json

translate:
	LIBRETRANSLATE_URL=$(LIBRETRANSLATE_URL) node scripts/translate.js

image:
	docker build -t $(IMAGE) .

nginx-verify: image
	@echo "== with a token =="
	@docker run --rm -e MIG_GITHUB_TOKEN=ghp_verify_only $(IMAGE) sh -c \
		'/docker-entrypoint.d/10-mig-github.sh >/dev/null; nginx -t 2>&1 | tail -1; \
		 grep -q "Bearer ghp_verify_only" /etc/nginx/mig-github.conf && echo "token reaches nginx: yes"; \
		 grep -o "proxy\":[a-z]*,\"alerts\":[a-z]*" /etc/nginx/mig-github.conf'
	@echo "== without a token =="
	@docker run --rm $(IMAGE) sh -c \
		'/docker-entrypoint.d/10-mig-github.sh >/dev/null; nginx -t 2>&1 | tail -1; \
		 grep -q Authorization\ \"\" /etc/nginx/mig-github.conf && echo "no Authorization header: yes"; \
		 grep -o "proxy\":[a-z]*,\"alerts\":[a-z]*" /etc/nginx/mig-github.conf'
	@echo "== with alerts allowed =="
	@docker run --rm -e MIG_GITHUB_TOKEN=ghp_verify_only -e MIG_GITHUB_ALERTS=true $(IMAGE) sh -c \
		'/docker-entrypoint.d/10-mig-github.sh >/dev/null; nginx -t 2>&1 | tail -1; \
		 echo "alert locations: $$(grep -c "/alerts)" /etc/nginx/mig-github.conf)"; \
		 echo "secrets hidden: $$(grep -c "hide_secret=true" /etc/nginx/mig-github.conf)"; \
		 grep -o "proxy\":[a-z]*,\"alerts\":[a-z]*" /etc/nginx/mig-github.conf'

nginx-probe: image
	@docker run --rm $(IMAGE) sh -c \
		'/docker-entrypoint.d/10-mig-github.sh >/dev/null; nginx & sleep 2; \
		 echo "gh-config.json: $$(wget -qO- http://127.0.0.1/gh-config.json)"; \
		 echo "unlisted /gh/user: $$(wget -S -qO- http://127.0.0.1/gh/user 2>&1 | grep -o "HTTP/1.1 [0-9]*" | head -1)"; \
		 echo "listed /gh/repos/o/r: $$(wget -S -qO- http://127.0.0.1/gh/repos/infinito-nexus/core 2>&1 | grep -o "HTTP/1.1 [0-9]*" | head -1)"; \
		 for ref in forks branches tags commits commits/f99de7de security-advisories dependabot/alerts; do \
		   echo "  /gh/.../$$ref: $$(wget -S -qO- http://127.0.0.1/gh/repos/infinito-nexus/core/$$ref 2>&1 | grep -o "HTTP/1.1 [0-9]*" | head -1)"; \
		 done'

git-status:
	@docker compose -f $(COMPOSE_FILE) exec -T $(SERVICE) sh -c \
		'echo "mirror: $$(ls -d $$MIG_GIT_HOME/mirror.git 2>/dev/null || echo MISSING)"; \
		 echo "commits: $$(git --git-dir $$MIG_GIT_HOME/mirror.git rev-list --count --all 2>&1)"; \
		 echo "remotes: $$(git --git-dir $$MIG_GIT_HOME/mirror.git remote | tr "\n" " ")"; \
		 echo "service: $$(pgrep -f mig-git.py >/dev/null && echo running || echo DOWN)"; \
		 echo "direct : $$(wget -S -qO- http://127.0.0.1:$$MIG_GIT_PORT/catalog 2>&1 | grep -o "HTTP/1.[01] [0-9]*" | head -1)"; \
		 echo "proxied: $$(wget -S -qO- http://127.0.0.1/git/catalog 2>&1 | grep -o "HTTP/1.1 [0-9]*" | head -1)"'

gh-status:
	@docker compose -f $(COMPOSE_FILE) exec -T $(SERVICE) sh -c \
		'echo "gh-config.json: $$(wget -qO- http://127.0.0.1/gh-config.json)"; \
		 grep -q "Bearer ." /etc/nginx/mig-github.conf \
		   && echo "token in nginx: yes" || echo "token in nginx: NO"; \
		 for ref in forks branches tags commits commits/f99de7de security-advisories dependabot/alerts; do \
		   echo "  /gh/.../$$ref: $$(wget -S -qO- http://127.0.0.1/gh/repos/infinito-nexus/core/$$ref 2>&1 | grep -o "HTTP/1.1 [0-9]*" | head -1)"; \
		 done'

clean:
	docker compose -f $(COMPOSE_FILE) down -v --remove-orphans
