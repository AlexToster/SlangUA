"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.BashSession = void 0;
exports.setupSkills = setupSkills;
exports.resolveSkillVersion = resolveSkillVersion;
exports.extractSkillArchive = extractSkillArchive;
exports.betaAgentToolset20260401 = betaAgentToolset20260401;
exports.resolvePath = resolvePath;
exports.betaBashTool = betaBashTool;
exports.betaReadTool = betaReadTool;
exports.betaWriteTool = betaWriteTool;
exports.betaEditTool = betaEditTool;
exports.betaGlobTool = betaGlobTool;
exports.betaGrepTool = betaGrepTool;
const error_1 = require("../../core/error.js");
function nodeOnly(name) {
    throw new error_1.AnthropicError(`${name} requires Node.js or a Node-compatible runtime`);
}
function setupSkills(_ctx) {
    return nodeOnly('setupSkills');
}
function resolveSkillVersion(_client, _skillId, _version) {
    return nodeOnly('resolveSkillVersion');
}
function extractSkillArchive(_resp, _dest) {
    return nodeOnly('extractSkillArchive');
}
function betaAgentToolset20260401(_ctx) {
    return nodeOnly('betaAgentToolset20260401');
}
function resolvePath(_ctx, _p) {
    return nodeOnly('resolvePath');
}
class BashSession {
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
exports.BashSession = BashSession;
function betaBashTool(_ctx) {
    return nodeOnly('betaBashTool');
}
function betaReadTool(_ctx) {
    return nodeOnly('betaReadTool');
}
function betaWriteTool(_ctx) {
    return nodeOnly('betaWriteTool');
}
function betaEditTool(_ctx) {
    return nodeOnly('betaEditTool');
}
function betaGlobTool(_ctx) {
    return nodeOnly('betaGlobTool');
}
function betaGrepTool(_ctx) {
    return nodeOnly('betaGrepTool');
}
//# sourceMappingURL=node.browser.js.map