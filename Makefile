SHELL := /usr/bin/env bash

-include .env

COMPOSE_FILE ?= compose.yml
BASE_URL ?= http://127.0.0.1:$(MIG_PORT)
SERVICE ?= meta-infinite-graph

IMAGE ?= meta-infinite-graph:local
# Param: MIG_CHROMIUM  path to a chromium binary, for hosts where playwright
#   cannot install its own. Empty means playwright uses its bundled browser.
MIG_CHROMIUM ?=

.PHONY: help up down logs rebuild e2e test test-fast image nginx-verify nginx-probe gh-status clean

help:
	@echo "Targets:"
	@echo "  make up                  Start stack (config from .env, generated from default.env)"
	@echo "  make down                Stop stack"
	@echo "  make logs                Follow service logs"
	@echo "  make rebuild             Down + up"
	@echo "  make e2e                 Start stack, run HTTP E2E checks, stop stack"
	@echo "  make test                Install browsers, then run the Playwright suite"
	@echo "  make test-fast           Run the Playwright suite without installing"
	@echo "  make image               Build the container image"
	@echo "  make nginx-verify        Check the generated GitHub proxy config, with and without a token"
	@echo "  make nginx-probe         Serve the image and probe the proxy routes"
	@echo "  make gh-status           Report what the RUNNING stack does with the GitHub token"
	@echo "  make clean               Down + remove volumes"

.env:
	cp default.env .env

up: .env
	docker compose -f $(COMPOSE_FILE) up -d --build --force-recreate

down:
	docker compose -f $(COMPOSE_FILE) down --remove-orphans

logs:
	docker compose -f $(COMPOSE_FILE) logs -f $(SERVICE)

rebuild: down up

e2e: .env
	@set -euo pipefail; \
	trap 'docker compose -f $(COMPOSE_FILE) down --remove-orphans' EXIT; \
	docker compose -f $(COMPOSE_FILE) up -d --build --force-recreate; \
	BASE_URL=$(BASE_URL) tests/e2e/test_http.sh

test:
	npm install
	npx playwright install chromium
	MIG_CHROMIUM=$(MIG_CHROMIUM) npx playwright test

test-fast:
	MIG_CHROMIUM=$(MIG_CHROMIUM) npx playwright test $(ARGS)

image:
	docker build -t $(IMAGE) .

nginx-verify: image
	@echo "== with a token =="
	@docker run --rm -e MIG_GITHUB_TOKEN=ghp_verify_only $(IMAGE) sh -c \
		'/docker-entrypoint.d/10-mig-github.sh >/dev/null; nginx -t 2>&1 | tail -1; \
		 grep -q "Bearer ghp_verify_only" /etc/nginx/mig-github.conf && echo "token reaches nginx: yes"; \
		 grep -o "proxy\":[a-z]*" /etc/nginx/mig-github.conf'
	@echo "== without a token =="
	@docker run --rm $(IMAGE) sh -c \
		'/docker-entrypoint.d/10-mig-github.sh >/dev/null; nginx -t 2>&1 | tail -1; \
		 grep -q Authorization\ \"\" /etc/nginx/mig-github.conf && echo "no Authorization header: yes"; \
		 grep -o "proxy\":[a-z]*" /etc/nginx/mig-github.conf'

nginx-probe: image
	@docker run --rm $(IMAGE) sh -c \
		'/docker-entrypoint.d/10-mig-github.sh >/dev/null; nginx & sleep 2; \
		 echo "gh-config.json: $$(wget -qO- http://127.0.0.1/gh-config.json)"; \
		 echo "unlisted /gh/user: $$(wget -S -qO- http://127.0.0.1/gh/user 2>&1 | grep -o "HTTP/1.1 [0-9]*" | head -1)"; \
		 echo "listed /gh/repos/o/r: $$(wget -S -qO- http://127.0.0.1/gh/repos/infinito-nexus/core 2>&1 | grep -o "HTTP/1.1 [0-9]*" | head -1)"; \
		 for ref in forks branches tags commits; do \
		   echo "  /gh/.../$$ref: $$(wget -S -qO- http://127.0.0.1/gh/repos/infinito-nexus/core/$$ref 2>&1 | grep -o "HTTP/1.1 [0-9]*" | head -1)"; \
		 done'

gh-status:
	@docker compose -f $(COMPOSE_FILE) exec -T $(SERVICE) sh -c \
		'echo "gh-config.json: $$(wget -qO- http://127.0.0.1/gh-config.json)"; \
		 grep -q "Bearer ." /etc/nginx/mig-github.conf \
		   && echo "token in nginx: yes" || echo "token in nginx: NO"; \
		 for ref in forks branches tags commits; do \
		   echo "  /gh/.../$$ref: $$(wget -S -qO- http://127.0.0.1/gh/repos/infinito-nexus/core/$$ref 2>&1 | grep -o "HTTP/1.1 [0-9]*" | head -1)"; \
		 done'

clean:
	docker compose -f $(COMPOSE_FILE) down -v --remove-orphans
