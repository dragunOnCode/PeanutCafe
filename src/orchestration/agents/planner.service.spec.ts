import { PlannerService } from './planner.service';

describe('PlannerService', () => {
  let planner: PlannerService;
  let mockAdapter: jest.Mocked<any>;

  beforeEach(() => {
    mockAdapter = {
      generate: jest.fn(),
    };
    planner = new PlannerService(mockAdapter);
  });

  it('should be instantiable', () => {
    expect(planner).toBeInstanceOf(PlannerService);
  });

  it('should have plan method', () => {
    expect(typeof planner.plan).toBe('function');
  });
});
