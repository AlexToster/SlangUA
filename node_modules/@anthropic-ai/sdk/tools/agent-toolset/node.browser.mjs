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
import { AnthropicError } from "../../core/error.mjs";
function nodeOnly(name) {
    throw new AnthropicError(`${name} requires Node.js or a Node-compatible runtime`);
}
export function setupSkills(_ctx) {
    return nodeOnly('setupSkills');
}
export function resolveSkillVersion(_client, _skillId, _version) {
    return nodeOnly('resolveSkillVersion');
}
export function extractSkillArchive(_resp, _dest) {
    return nodeOnly('extractSkillArchive');
}
export function betaAgentToolset20260401(_ctx) {
    return nodeOnly('betaAgentToolset20260401');
}
export function resolvePath(_ctx, _p) {
    return nodeOnly('resolvePath');
}
export class BashSession {
    constructor(_dir, _env) {
        nodeOnly('BashSession');
    }
    get closed() {
        return nodeOnly('BashSession');
    }
    exec(_command, _opts = {}) {
        return nodeOnly('BashSession');
    }
    close() {
        nodeOnly('BashSession');
    }
}
export function betaBashTool(_ctx) {
    return nodeOnly('betaBashTool');
}
export function betaReadTool(_ctx) {
    return nodeOnly('betaReadTool');
}
export function betaWriteTool(_ctx) {
    return nodeOnly('betaWriteTool');
}
export function betaEditTool(_ctx) {
    return nodeOnly('betaEditTool');
}
export function betaGlobTool(_ctx) {
    return nodeOnly('betaGlobTool');
}
export function betaGrepTool(_ctx) {
    return nodeOnly('betaGrepTool');
}
//# sourceMappingURL=node.browser.mjs.map