import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CostTracker } from '../shared/guardrails/cost-tracker.js';

// Mock the SDK
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
  createSdkMcpServer: vi.fn((options) => ({
    name: options.name,
    instance: 'mock-instance',
  })),
}));

// Import after mocking
import {
  runAgentLoop,
  type AgentLoopConfig,
  type McpServerConfig,
  type AgentLoopOptions,
} from '../core/runtime/agent-loop.js';
import { query, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';

describe('AgentLoop', () => {
  let costTracker: CostTracker;
  let config: AgentLoopConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    costTracker = new CostTracker({
      agentName: 'test-agent',
      maxDailyCostUsd: 100,
    });

    config = {
      name: 'test-agent',
      systemPrompt: 'You are a test agent.',
      model: 'claude-sonnet-4-20250514',
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('runAgentLoop', () => {
    it('creates MCP servers from config', async () => {
      const mockTools = [{ name: 'test-tool', handler: vi.fn() }];
      const mcpServers: McpServerConfig[] = [
        { name: 'server-1', tools: mockTools as any },
        { name: 'server-2', tools: mockTools as any },
      ];

      // Mock query to return a simple result
      vi.mocked(query).mockImplementation(function* () {
        yield {
          type: 'system',
          subtype: 'init',
          session_id: 'test-session-123',
        };
        yield {
          type: 'assistant',
          message: {
            content: [{ text: 'Hello, I am a test response.' }],
          },
        };
        yield {
          type: 'result',
          subtype: 'end_turn',
          duration_ms: 100,
          total_cost_usd: 0.01,
        };
      } as any);

      const options: AgentLoopOptions = {
        costTracker,
        mcpServers,
      };

      await runAgentLoop(config, 'Test prompt', options);

      // Verify createSdkMcpServer was called for each server
      expect(createSdkMcpServer).toHaveBeenCalledTimes(2);
      expect(createSdkMcpServer).toHaveBeenCalledWith({
        name: 'server-1',
        tools: mockTools,
      });
      expect(createSdkMcpServer).toHaveBeenCalledWith({
        name: 'server-2',
        tools: mockTools,
      });
    });

    it('returns session ID from init message', async () => {
      vi.mocked(query).mockImplementation(function* () {
        yield {
          type: 'system',
          subtype: 'init',
          session_id: 'my-session-id',
        };
        yield {
          type: 'result',
          subtype: 'end_turn',
          duration_ms: 100,
          total_cost_usd: 0.01,
        };
      } as any);

      const result = await runAgentLoop(config, 'Test prompt', {
        costTracker,
        mcpServers: [],
      });

      expect(result.sessionId).toBe('my-session-id');
    });

    it('returns final text response', async () => {
      vi.mocked(query).mockImplementation(function* () {
        yield { type: 'system', subtype: 'init', session_id: 'test' };
        yield {
          type: 'assistant',
          message: {
            content: [{ text: 'First response' }],
          },
        };
        yield {
          type: 'assistant',
          message: {
            content: [{ text: 'Final response' }],
          },
        };
        yield {
          type: 'result',
          subtype: 'end_turn',
          duration_ms: 100,
          total_cost_usd: 0.02,
        };
      } as any);

      const result = await runAgentLoop(config, 'Test prompt', {
        costTracker,
        mcpServers: [],
      });

      expect(result.response).toBe('Final response');
    });

    it('counts turns correctly', async () => {
      vi.mocked(query).mockImplementation(function* () {
        yield { type: 'system', subtype: 'init', session_id: 'test' };
        yield {
          type: 'assistant',
          message: {
            content: [{ text: 'Turn 1' }],
          },
        };
        yield {
          type: 'assistant',
          message: {
            content: [{ text: 'Turn 2' }],
          },
        };
        yield {
          type: 'assistant',
          message: {
            content: [{ text: 'Turn 3' }],
          },
        };
        yield {
          type: 'result',
          subtype: 'end_turn',
          duration_ms: 300,
          total_cost_usd: 0.03,
        };
      } as any);

      const result = await runAgentLoop(config, 'Test prompt', {
        costTracker,
        mcpServers: [],
      });

      expect(result.turns).toBe(3);
    });

    it('returns cost from result message', async () => {
      vi.mocked(query).mockImplementation(function* () {
        yield { type: 'system', subtype: 'init', session_id: 'test' };
        yield {
          type: 'result',
          subtype: 'end_turn',
          duration_ms: 100,
          total_cost_usd: 0.12345,
        };
      } as any);

      const result = await runAgentLoop(config, 'Test prompt', {
        costTracker,
        mcpServers: [],
      });

      expect(result.costUsd).toBe(0.12345);
    });

    it('passes resume session ID to query', async () => {
      vi.mocked(query).mockImplementation(function* () {
        yield { type: 'system', subtype: 'init', session_id: 'resumed-session' };
        yield {
          type: 'result',
          subtype: 'end_turn',
          duration_ms: 100,
          total_cost_usd: 0.01,
        };
      } as any);

      await runAgentLoop(config, 'Test prompt', {
        costTracker,
        mcpServers: [],
        sessionId: 'previous-session-id',
      });

      expect(query).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            resume: 'previous-session-id',
          }),
        })
      );
    });

    it('passes claude executable path when configured', async () => {
      vi.mocked(query).mockImplementation(function* () {
        yield { type: 'system', subtype: 'init', session_id: 'test' };
        yield {
          type: 'result',
          subtype: 'end_turn',
          duration_ms: 100,
          total_cost_usd: 0.01,
        };
      } as any);

      const configWithExecutable: AgentLoopConfig = {
        ...config,
        claudeExecutable: '/custom/path/to/claude',
      };

      await runAgentLoop(configWithExecutable, 'Test prompt', {
        costTracker,
        mcpServers: [],
      });

      expect(query).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            pathToClaudeCodeExecutable: '/custom/path/to/claude',
          }),
        })
      );
    });

    it('calls onStatusUpdate callback for status changes', async () => {
      const onStatusUpdate = vi.fn().mockResolvedValue(undefined);

      vi.mocked(query).mockImplementation(function* () {
        yield { type: 'system', subtype: 'init', session_id: 'test' };
        yield {
          type: 'result',
          subtype: 'end_turn',
          duration_ms: 100,
          total_cost_usd: 0.01,
        };
      } as any);

      await runAgentLoop(config, 'Test prompt', {
        costTracker,
        mcpServers: [],
        onStatusUpdate,
      });

      // Should call with initial "Thinking..." status
      expect(onStatusUpdate).toHaveBeenCalledWith('🤔 Thinking...');
    });

    it('calls onToolUse callback when tools are invoked', async () => {
      const onToolUse = vi.fn();

      vi.mocked(query).mockImplementation(function* () {
        yield { type: 'system', subtype: 'init', session_id: 'test' };
        yield {
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                name: 'Read',
                input: { file_path: '/test/file.ts' },
              },
            ],
          },
        };
        yield {
          type: 'result',
          subtype: 'end_turn',
          duration_ms: 100,
          total_cost_usd: 0.01,
        };
      } as any);

      await runAgentLoop(config, 'Test prompt', {
        costTracker,
        mcpServers: [],
        onToolUse,
      });

      expect(onToolUse).toHaveBeenCalledWith('Read', { file_path: '/test/file.ts' });
    });

    it('throws error when cost limit is exceeded before starting', async () => {
      // Create cost tracker that's already at limit
      const limitedCostTracker = new CostTracker({
        agentName: 'test-agent',
        maxDailyCostUsd: 0.01,
      });
      // Simulate exceeding the limit
      limitedCostTracker.trackUsage(0, 10000, 'claude-sonnet-4-20250514');

      await expect(
        runAgentLoop(config, 'Test prompt', {
          costTracker: limitedCostTracker,
          mcpServers: [],
        })
      ).rejects.toThrow();
    });

    it('throws error when query fails', async () => {
      // eslint-disable-next-line require-yield
      vi.mocked(query).mockImplementation(function* () {
        throw new Error('API connection failed');
      } as unknown as typeof query);

      await expect(
        runAgentLoop(config, 'Test prompt', {
          costTracker,
          mcpServers: [],
        })
      ).rejects.toThrow('API connection failed');
    });

    it('passes custom API base URL and blanks ANTHROPIC_API_KEY', async () => {
      vi.mocked(query).mockImplementation(function* () {
        yield { type: 'system', subtype: 'init', session_id: 'test' };
        yield {
          type: 'result',
          subtype: 'end_turn',
          duration_ms: 100,
          total_cost_usd: 0.01,
        };
      } as any);

      const configWithApi: AgentLoopConfig = {
        ...config,
        api: {
          baseUrl: 'https://openrouter.ai/api',
        },
      };

      await runAgentLoop(configWithApi, 'Test prompt', {
        costTracker,
        mcpServers: [],
      });

      expect(query).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            env: expect.objectContaining({
              ANTHROPIC_BASE_URL: 'https://openrouter.ai/api',
              ANTHROPIC_API_KEY: '', // Must be empty for OpenRouter
            }),
          }),
        })
      );
    });

    it('passes custom API headers via ANTHROPIC_CUSTOM_HEADERS env var', async () => {
      vi.mocked(query).mockImplementation(function* () {
        yield { type: 'system', subtype: 'init', session_id: 'test' };
        yield {
          type: 'result',
          subtype: 'end_turn',
          duration_ms: 100,
          total_cost_usd: 0.01,
        };
      } as any);

      const configWithHeaders: AgentLoopConfig = {
        ...config,
        api: {
          headers: {
            'X-Custom-Header': 'custom-value',
            Authorization: 'Bearer token',
          },
        },
      };

      await runAgentLoop(configWithHeaders, 'Test prompt', {
        costTracker,
        mcpServers: [],
      });

      // Headers should be formatted as newline-separated "key: value" pairs
      expect(query).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            env: expect.objectContaining({
              ANTHROPIC_CUSTOM_HEADERS:
                'X-Custom-Header: custom-value\nAuthorization: Bearer token',
            }),
          }),
        })
      );
    });

    it('uses custom API key via ANTHROPIC_AUTH_TOKEN', async () => {
      // Set up environment variable
      const originalEnv = process.env.OPENROUTER_API_KEY;
      process.env.OPENROUTER_API_KEY = 'test-openrouter-key';

      vi.mocked(query).mockImplementation(function* () {
        yield { type: 'system', subtype: 'init', session_id: 'test' };
        yield {
          type: 'result',
          subtype: 'end_turn',
          duration_ms: 100,
          total_cost_usd: 0.01,
        };
      } as any);

      const configWithApiKey: AgentLoopConfig = {
        ...config,
        api: {
          apiKey: 'OPENROUTER_API_KEY',
        },
      };

      await runAgentLoop(configWithApiKey, 'Test prompt', {
        costTracker,
        mcpServers: [],
      });

      // Verify env was passed to query with the custom key as ANTHROPIC_AUTH_TOKEN
      expect(query).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            env: expect.objectContaining({
              ANTHROPIC_AUTH_TOKEN: 'test-openrouter-key',
            }),
          }),
        })
      );

      // Restore original env
      if (originalEnv === undefined) {
        delete process.env.OPENROUTER_API_KEY;
      } else {
        process.env.OPENROUTER_API_KEY = originalEnv;
      }
    });

    it('does not pass api config when not provided', async () => {
      vi.mocked(query).mockImplementation(function* () {
        yield { type: 'system', subtype: 'init', session_id: 'test' };
        yield {
          type: 'result',
          subtype: 'end_turn',
          duration_ms: 100,
          total_cost_usd: 0.01,
        };
      } as any);

      await runAgentLoop(config, 'Test prompt', {
        costTracker,
        mcpServers: [],
      });

      const callOptions = vi.mocked(query).mock.calls[0][0].options;
      // extraArgs should not be set when no api config
      expect(callOptions).not.toHaveProperty('extraArgs');
      // env should not be set when no api config (process.env is not passed)
      expect(callOptions).not.toHaveProperty('env');
    });

    it('handles combined API configuration (baseUrl, headers, and apiKey)', async () => {
      // Set up environment variable
      const originalEnv = process.env.CUSTOM_API_KEY;
      process.env.CUSTOM_API_KEY = 'my-custom-key';

      vi.mocked(query).mockImplementation(function* () {
        yield { type: 'system', subtype: 'init', session_id: 'test' };
        yield {
          type: 'result',
          subtype: 'end_turn',
          duration_ms: 100,
          total_cost_usd: 0.01,
        };
      } as any);

      const configWithFullApi: AgentLoopConfig = {
        ...config,
        api: {
          baseUrl: 'https://my-proxy.example.com/v1',
          apiKey: 'CUSTOM_API_KEY',
          headers: { 'X-Org-Id': 'org-123' },
        },
      };

      await runAgentLoop(configWithFullApi, 'Test prompt', {
        costTracker,
        mcpServers: [],
      });

      expect(query).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            env: expect.objectContaining({
              ANTHROPIC_API_KEY: '', // Must be empty for OpenRouter
              ANTHROPIC_AUTH_TOKEN: 'my-custom-key',
              ANTHROPIC_BASE_URL: 'https://my-proxy.example.com/v1',
              ANTHROPIC_CUSTOM_HEADERS: 'X-Org-Id: org-123',
            }),
          }),
        })
      );

      // Restore original env
      if (originalEnv === undefined) {
        delete process.env.CUSTOM_API_KEY;
      } else {
        process.env.CUSTOM_API_KEY = originalEnv;
      }
    });
  });

  describe('status message generation', () => {
    it('generates correct status for tool calls', async () => {
      const onStatusUpdate = vi.fn().mockResolvedValue(undefined);

      vi.mocked(query).mockImplementation(function* () {
        yield { type: 'system', subtype: 'init', session_id: 'test' };
        yield {
          type: 'assistant',
          message: {
            content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm run build' } }],
          },
        };
        yield {
          type: 'assistant',
          message: {
            content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/path/to/file.ts' } }],
          },
        };
        yield {
          type: 'assistant',
          message: {
            content: [{ type: 'tool_use', name: 'Write', input: { file_path: '/new/file.ts' } }],
          },
        };
        yield {
          type: 'assistant',
          message: {
            content: [{ type: 'tool_use', name: 'Grep', input: { pattern: 'searchTerm' } }],
          },
        };
        yield {
          type: 'result',
          subtype: 'end_turn',
          duration_ms: 100,
          total_cost_usd: 0.01,
        };
      } as any);

      await runAgentLoop(config, 'Test prompt', {
        costTracker,
        mcpServers: [],
        onStatusUpdate,
      });

      const calls = onStatusUpdate.mock.calls.map((c) => c[0]);
      expect(calls).toContain('⚙️ Running `npm`...');
      expect(calls).toContain('📄 Reading `file.ts`...');
      expect(calls).toContain('📝 Writing `file.ts`...');
      expect(calls).toContain('🔎 Searching for "searchTerm"...');
    });
  });
});
