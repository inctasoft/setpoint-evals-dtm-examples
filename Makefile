.PHONY: help start-standalone start-integrated stop restart purge clean
.PHONY: deploy-workers deploy-workers-esm deploy-workers-poller list-workers
.PHONY: monitor-api monitor-sqs logs
.PHONY: e2e-all e2e-parallel e2e-sequential e2e-skip-purge
.PHONY: build test lint format

help: ## Show this help message
	@echo "DTM - Distributed Task Manager - Available Commands"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-30s\033[0m %s\n", $$1, $$2}'
	@echo ""

# =============================================================================
# Local Environment Management (via scripts/local-env.sh)
# =============================================================================

start-standalone: ## Start all services with local Kafka (Standalone Mode)
	./scripts/local-env.sh start --standalone --orchestrator --front-end

start-integrated: ## Start services using backend-apps Kafka (Integrated Mode)
	./scripts/local-env.sh start --integrated --orchestrator --front-end

stop: ## Stop all services
	./scripts/local-env.sh stop

restart: ## Restart all services (Standalone)
	./scripts/local-env.sh stop && ./scripts/local-env.sh start --standalone --orchestrator --front-end

purge: ## Purge database, SQS queues, and Kafka topics (keeps services running)
	./scripts/local-env.sh purge

clean: ## Stop all services and remove volumes
	./scripts/local-env.sh clean

deploy-workers: ## Deploy Lambda workers (default: ESM mode)
	./scripts/local-env.sh deploy-workers

deploy-workers-esm: ## Deploy Lambda workers in ESM mode (Parallel)
	./scripts/local-env.sh deploy-workers --esm

deploy-workers-hot: ## Deploy Lambda workers in Hot Reload mode (ESM)
	./scripts/local-env.sh deploy-workers --esm --hot-reload

deploy-workers-poller: ## Deploy Lambda workers in Poller mode (Sequential). Usage: make deploy-workers-poller [COUNT=N]
	./scripts/local-env.sh deploy-workers --poller $(if $(COUNT),--count=$(COUNT))

deploy-workers-poller-hot: ## Deploy Lambda workers in Hot Reload mode (Poller). Usage: make deploy-workers-poller-hot [COUNT=N]
	./scripts/local-env.sh deploy-workers --poller --hot-reload $(if $(COUNT),--count=$(COUNT))

scale-pollers: ## Scale SQS pollers to specific count (no redeploy). Usage: make scale-pollers COUNT=N
	./scripts/local-env.sh scale-pollers $(COUNT)

add-pollers: ## Add N SQS pollers (default 1). Usage: make add-pollers [N=1]
	@N=$${N:-1}; \
	CURRENT=$$(docker ps --filter "name=dtm-sqs-poller" --format "{{.Names}}" | wc -l); \
	NEW_COUNT=$$((CURRENT + N)); \
	echo "Adding $$N poller(s) (Total: $$NEW_COUNT)..."; \
	./scripts/local-env.sh scale-pollers $$NEW_COUNT

remove-pollers: ## Remove N SQS pollers (default 1). Usage: make remove-pollers [N=1]
	@N=$${N:-1}; \
	CURRENT=$$(docker ps --filter "name=dtm-sqs-poller" --format "{{.Names}}" | wc -l); \
	NEW_COUNT=$$((CURRENT - N)); \
	if [ $$NEW_COUNT -lt 0 ]; then NEW_COUNT=0; fi; \
	echo "Removing $$N poller(s) (Total: $$NEW_COUNT)..."; \
	./scripts/local-env.sh scale-pollers $$NEW_COUNT

list-workers: ## List deployed Lambda workers
	./scripts/local-env.sh list workers

monitor-api: ## Monitor jobs via API
	./scripts/local-env.sh monitor api

monitor-sqs: ## Monitor SQS queues and DLQs
	./scripts/local-env.sh monitor sqs

logs: ## View logs for all services
	./scripts/local-env.sh logs

# =============================================================================
# E2E Evaluations (via e2e-evals/run-all.sh)
# =============================================================================

e2e-all: ## Run all E2E evaluations (Parallel mode by default)
	./e2e-evals/run-all.sh

e2e-parallel: ## Run E2E evaluations in parallel mode (Safe concurrently, Destructive sequentially)
	./e2e-evals/run-all.sh --parallel

e2e-sequential: ## Run all E2E evaluations sequentially (In-band)
	./e2e-evals/run-all.sh --in-band

e2e-skip-purge: ## Run E2E evaluations without initial purge
	./e2e-evals/run-all.sh --skip-purge

# =============================================================================
# Development Commands
# =============================================================================

build: ## Build TypeScript (orchestrator + lambda)
	pnpm build

test: ## Run tests (orchestrator + lambda)
	pnpm test

lint: ## Check code style
	pnpm lint

format: ## Format code
	pnpm format
