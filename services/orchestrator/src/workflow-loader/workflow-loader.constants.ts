/**
 * Injection token for the loaded WorkflowDefinition.
 *
 * Services that need workflow configuration inject this:
 *   constructor(@Inject(WORKFLOW_DEFINITION) private readonly workflow: WorkflowDefinition) {}
 *
 * Loaded at boot time from the registered workflow definitions.
 */
export const WORKFLOW_DEFINITION = 'WORKFLOW_DEFINITION';
