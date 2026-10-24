import type { ToolResponse } from '../response.js';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    /**
     * Always declared, `[]` when nothing is required — an absent `required` is
     * ambiguous to read, while `[]` states "this is callable with no arguments".
     */
    required: string[];
    /**
     * Always `false`. Nothing validates a tool's arguments against this schema
     * before dispatch (index.ts calls the handler directly, and each handler
     * does its own zod parse, which strips unknown keys). So this is the only
     * place the closed-object contract is stated at all: without it a model
     * that invents an argument gets a success it should not have and never
     * learns the parameter does not exist.
     */
    additionalProperties: false;
  };
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResponse>;

export interface Tool {
  definition: ToolDefinition;
  handler: ToolHandler;
}
