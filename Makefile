SHELL := /usr/bin/env bash

PORT ?= 8000
IMAGE ?= mig-local
COMPOSE_FILE ?= compose.yml
BASE_URL ?= http://127.0.0.1:$(PORT)
SERVICE ?= meta-infinite-graph

.PHONY: help build run up down logs rebuild e2e clean

help:
	@echo "Targets:"
	@echo "  make build               Build local Docker image ($(IMAGE))"
	@echo "  make run                 Run image on PORT=$(PORT)"
	@echo "  make up                  Start compose stack (build + recreate)"
	@echo "  make down                Stop compose stack"
	@echo "  make logs                Follow service logs"
	@echo "  make rebuild             Down + up"
	@echo "  make e2e                 Start stack, run HTTP E2E checks, stop stack"
	@echo "  make clean               Down + remove volumes"

build:
	docker build -t $(IMAGE) .

run:
	docker run --rm -p $(PORT):80 $(IMAGE)

up:
	MIG_PORT=$(PORT) docker compose -f $(COMPOSE_FILE) up -d --build --force-recreate

down:
	docker compose -f $(COMPOSE_FILE) down --remove-orphans

logs:
	docker compose -f $(COMPOSE_FILE) logs -f $(SERVICE)

rebuild: down up

e2e:
	@set -euo pipefail; \
	trap 'docker compose -f $(COMPOSE_FILE) down --remove-orphans' EXIT; \
	MIG_PORT=$(PORT) docker compose -f $(COMPOSE_FILE) up -d --build --force-recreate; \
	BASE_URL=$(BASE_URL) tests/e2e/test_http.sh

clean:
	docker compose -f $(COMPOSE_FILE) down -v --remove-orphans
