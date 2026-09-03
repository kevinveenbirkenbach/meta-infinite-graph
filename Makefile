SHELL := /usr/bin/env bash

-include .env

COMPOSE_FILE ?= compose.yml
BASE_URL ?= http://127.0.0.1:$(MIG_PORT)
SERVICE ?= meta-infinite-graph

# Param: MIG_CHROMIUM  path to a chromium binary, for hosts where playwright
#   cannot install its own. Empty means playwright uses its bundled browser.
MIG_CHROMIUM ?=

.PHONY: help up down logs rebuild e2e test test-fast clean

help:
	@echo "Targets:"
	@echo "  make up                  Start stack (config from .env, generated from default.env)"
	@echo "  make down                Stop stack"
	@echo "  make logs                Follow service logs"
	@echo "  make rebuild             Down + up"
	@echo "  make e2e                 Start stack, run HTTP E2E checks, stop stack"
	@echo "  make test                Install browsers, then run the Playwright suite"
	@echo "  make test-fast           Run the Playwright suite without installing"
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

clean:
	docker compose -f $(COMPOSE_FILE) down -v --remove-orphans
