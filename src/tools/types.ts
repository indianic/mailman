import type { ToolResponse } from '../response.js';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResponse>;

export interface Tool {
  definition: ToolDefinition;
  handler: ToolHandler;
}
