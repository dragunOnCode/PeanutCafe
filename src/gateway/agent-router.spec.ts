import { Test, TestingModule } from '@nestjs/testing';
import { AgentRouter, RouteResult } from './agent-router';
import { AgentPriorityService } from '../agents/services/agent-priority.service';
import { ILLMAdapter, AgentStatus } from '../agents/interfaces/llm-adapter.interface';

const createMockAgent = (id: string, name: string): ILLMAdapter => ({
  id,
  name,
  model: 'test-model',
  type: 'test',
  role: 'test-role',
  capabilities: [],
  callType: 'http',
  generate: jest.fn(),
  streamGenerate: jest.fn(),
  shouldRespond: jest.fn(),
  healthCheck: jest.fn().mockResolvedValue(true),
  getStatus: jest.fn().mockReturnValue(AgentStatus.ONLINE),
});

describe('AgentRouter', () => {
  let router: AgentRouter;
  let priorityService: AgentPriorityService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentRouter,
        {
          provide: AgentPriorityService,
          useValue: {
            selectByPriority: jest.fn(),
            getDynamicPriority: jest.fn(),
          },
        },
      ],
    }).compile();

    router = module.get<AgentRouter>(AgentRouter);
    priorityService = module.get<AgentPriorityService>(AgentPriorityService);
  });

  describe('registerAgent', () => {
    it('should register agent by id and name', () => {
      const agent = createMockAgent('agent-1', 'TestAgent');
      router.registerAgent(agent);

      expect(router.getAgentById('agent-1')).toBe(agent);
      expect(router.getAllAgents()).toContain(agent);
    });

    it('should register agent name case-insensitively', () => {
      const agent = createMockAgent('agent-2', 'SpecialAgent');
      router.registerAgent(agent);

      expect(router.getAgentById('agent-2')).toBe(agent);
    });
  });

  describe('route with @mention', () => {
    it('should return mentioned agents with processed content', () => {
      const agent1 = createMockAgent('agent-1', 'Alpha');
      const agent2 = createMockAgent('agent-2', 'Beta');
      router.registerAgent(agent1);
      router.registerAgent(agent2);

      const result: RouteResult = router.route(['Alpha', 'Beta'], 'Hello @Alpha and @Beta');

      expect(result.targetAgents).toEqual([agent1, agent2]);
      expect(result.processedContent).toBe('Hello and');
    });
  });

  describe('route without @mention', () => {
    it('should return highest priority agent', () => {
      const agent1 = createMockAgent('agent-1', 'Low');
      const agent2 = createMockAgent('agent-2', 'High');
      router.registerAgent(agent1);
      router.registerAgent(agent2);

      (priorityService.selectByPriority as jest.Mock).mockReturnValue('agent-2');

      const result: RouteResult = router.route([], 'Hello world');

      expect(result.targetAgents).toEqual([agent2]);
      expect(result.processedContent).toBe('Hello world');
      expect(priorityService.selectByPriority).toHaveBeenCalled();
    });
  });

  describe('removeMentions', () => {
    it('should strip @mentions from content', () => {
      const agent = createMockAgent('agent-1', 'TestAgent');
      router.registerAgent(agent);

      const result: RouteResult = router.route(['TestAgent'], '@TestAgent Hello @Unknown');

      expect(result.processedContent).toBe('Hello');
    });
  });

  describe('getAgentById', () => {
    it('should return agent by id', () => {
      const agent = createMockAgent('test-id', 'TestAgent');
      router.registerAgent(agent);

      expect(router.getAgentById('test-id')).toBe(agent);
      expect(router.getAgentById('unknown')).toBeUndefined();
    });
  });

  describe('getAllAgents', () => {
    it('should return all registered agents', () => {
      const agent1 = createMockAgent('id-1', 'AgentOne');
      const agent2 = createMockAgent('id-2', 'AgentTwo');
      router.registerAgent(agent1);
      router.registerAgent(agent2);

      const all = router.getAllAgents();
      expect(all).toHaveLength(2);
      expect(all).toContain(agent1);
      expect(all).toContain(agent2);
    });
  });
});