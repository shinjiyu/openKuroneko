/**
 * 外脑工具接口 — 与内脑 Tool 接口同构，但工具集严格受限。
 */

export interface ObTool {
  name: string;
  description: string;
  parameters: Record<string, ObToolParam>;
  call(args: Record<string, unknown>): Promise<ObToolResult>;
}

export interface ObToolParam {
  type: 'string' | 'number' | 'boolean';
  description: string;
  required?: boolean;
}

export interface ObToolResult {
  ok: boolean;
  output: string;
}

export function buildToolDef(tool: ObTool): object {
  const required = Object.entries(tool.parameters)
    .filter(([, p]) => p.required)
    .map(([k]) => k);

  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(
          Object.entries(tool.parameters).map(([k, p]) => [
            k,
            { type: p.type, description: p.description },
          ]),
        ),
        required,
      },
    },
  };
}
