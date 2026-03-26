import { WORKFLOW_NODES } from './workflow.graph';

describe('WORKFLOW_NODES', () => {
  it('should have all required node names', () => {
    expect(WORKFLOW_NODES.HYDRATE).toBe('hydrate_session_state');
    expect(WORKFLOW_NODES.ROUTE).toBe('route_message');
    expect(WORKFLOW_NODES.RUN_TASK).toBe('run_task');
    expect(WORKFLOW_NODES.CHECK_OUTPUT).toBe('check_output');
    expect(WORKFLOW_NODES.AWAIT_REVIEW).toBe('await_human_review');
    expect(WORKFLOW_NODES.ROUTE_AGENT).toBe('route_to_next_agent');
    expect(WORKFLOW_NODES.HANDLE_ERROR).toBe('handle_error');
  });
});
