export const WORKFLOW_NODES = {
  HYDRATE: 'hydrate_session_state',
  ROUTE: 'route_current_message',
  RUN_TASK: 'run_next_task',
} as const;

export type WorkflowNodeName = (typeof WORKFLOW_NODES)[keyof typeof WORKFLOW_NODES];
