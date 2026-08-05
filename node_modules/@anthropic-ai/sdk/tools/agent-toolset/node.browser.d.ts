/**
 * Browser stub for `tools/agent-toolset/node`.
 *
 * The real module implements the `agent_toolset_20260401` tools on top of Node
 * built-ins (`node:child_process`, `node:fs`, …), which browser bundlers cannot
 * resolve. The `browser` field in `package.json` substitutes this stub in
 * browser builds so the SDK bundles cleanly for web targets; Node runtimes and
 * node-target bundles ignore the mapping and load the real implementation.
 *
 * Every value export here throws an {@link AnthropicError} when used — the
 * agent toolset only works in Node.js or a Node-compatible runtime. Type
 * exports are re-exported from the real module (erased at build time), so
 * type-level usage is unaffected.
 */
import type { Anthropic } from "../../client.js";
import type { BetaRunnableTool } from "../../lib/tools/BetaRunnableTool.js";
import type { AgentToolContext } from "./node.js";
export type { AgentToolContext } from "./node.js";
export declare function setupSkills(_ctx: AgentToolContext): Promise<() => Promise<void>>;
export declare function resolveSkillVersion(_client: Anthropic, _skillId: string, _version: string): Promise<string>;
export declare function extractSkillArchive(_resp: Response, _dest: string): Promise<void>;
export declare function betaAgentToolset20260401(_ctx: AgentToolContext): BetaRunnableTool[];
export declare function resolvePath(_ctx: AgentToolContext, _p: string): Promise<string>;
export declare class BashSession {
    constructor(_dir: string, _env?: NodeJS.ProcessEnv);
    get closed(): boolean;
    exec(_command: string, _opts?: {
        timeoutMs?: number;
        signal?: AbortSignal | null | undefined;
    }): Promise<{
        output: string;
        exitCode: number;
    }>;
    close(): void;
}
export declare function betaBashTool(_ctx: AgentToolContext): BetaRunnableTool;
export declare function betaReadTool(_ctx: AgentToolContext): BetaRunnableTool;
export declare function betaWriteTool(_ctx: AgentToolContext): BetaRunnableTool;
export declare function betaEditTool(_ctx: AgentToolContext): BetaRunnableTool;
export declare function betaGlobTool(_ctx: AgentToolContext): BetaRunnableTool;
export declare function betaGrepTool(_ctx: AgentToolContext): BetaRunnableTool;
//# sourceMappingURL=node.browser.d.ts.map