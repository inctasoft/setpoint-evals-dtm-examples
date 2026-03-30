/**
 * @dtm/core — Distributed Task Manager Core
 *
 * This package contains the interfaces and types that define the DTM contract.
 * Workflow authors implement WorkflowDefinition to plug into the DTM engine.
 * Workers use callback payload types to communicate with the orchestrator.
 *
 * Usage:
 *   import { WorkflowDefinition, StepDefinition, StepStatus } from '@dtm/core';
 */
export * from "./interfaces";
