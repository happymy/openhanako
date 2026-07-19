import {
  normalizeStageFilesParams,
  STAGE_FILES_EXECUTION_BOUNDARY,
} from "../tools/output-file-tool.ts";

const GIT_PUSH_RULES = {
  force: {
    id: "force-push-blocked",
    reason: "Force push is blocked by Hana safety policy.",
  },
  tags: {
    id: "push-tags-blocked",
    reason: "Bulk tag push is blocked by Hana safety policy. Push one explicit tag ref after release review.",
  },
  all: {
    id: "push-all-blocked",
    reason: "Pushing all branches is blocked by Hana safety policy.",
  },
  mirror: {
    id: "push-mirror-blocked",
    reason: "Mirror push is blocked by Hana safety policy.",
  },
};

function commandFromRequest(request: any = {}) {
  const command = request.params?.command || request.params?.cmd || request.target?.label;
  return typeof command === "string" ? command : "";
}

function tokenizeCommand(command) {
  const tokens = [];
  let token = "";
  let quote = null;
  let escaped = false;
  for (const char of command) {
    if (escaped) {
      token += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else token += char;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (token) tokens.push(token);
      token = "";
      continue;
    }
    token += char;
  }
  if (token) tokens.push(token);
  return tokens;
}

function executableBasename(token) {
  const normalized = String(token || "").replace(/\\/g, "/").toLowerCase();
  const slash = normalized.lastIndexOf("/");
  return slash >= 0 ? normalized.slice(slash + 1) : normalized;
}

function isGitExecutableToken(token) {
  const base = executableBasename(token);
  return base === "git" || base === "git.exe";
}

function nestedShellCommand(tokens, index) {
  const base = executableBasename(tokens[index]);
  const isPosixShell = base === "sh" || base === "sh.exe"
    || base === "bash" || base === "bash.exe"
    || base === "zsh" || base === "zsh.exe"
    || base === "fish" || base === "fish.exe";
  if (isPosixShell) {
    for (let i = index + 1; i < tokens.length; i += 1) {
      const token = tokens[i];
      if (token === "--") return null;
      if (token === "-c" || (/^-[^-]+$/.test(token) && token.includes("c"))) return tokens[i + 1] || null;
      if (!token.startsWith("-")) return null;
    }
    return null;
  }

  const isPowerShell = base === "powershell" || base === "powershell.exe"
    || base === "pwsh" || base === "pwsh.exe";
  if (isPowerShell) {
    for (let i = index + 1; i < tokens.length; i += 1) {
      const token = String(tokens[i] || "").toLowerCase();
      if (token === "-command" || token === "-c" || token === "/c") return tokens[i + 1] || null;
    }
    return null;
  }

  if (base === "cmd" || base === "cmd.exe") {
    for (let i = index + 1; i < tokens.length; i += 1) {
      const token = String(tokens[i] || "").toLowerCase();
      if (token === "/c" || token === "-c") return tokens[i + 1] || null;
    }
  }
  return null;
}

function gitGlobalOptionConsumesValue(token) {
  if (token.includes("=")) return false;
  return token === "-C"
    || token === "-c"
    || token === "--git-dir"
    || token === "--work-tree"
    || token === "--namespace"
    || token === "--exec-path"
    || token === "--config-env"
    || token === "--super-prefix";
}

function detectGitPush(command, depth = 0) {
  const tokens = tokenizeCommand(command);
  for (let i = 0; i < tokens.length; i += 1) {
    if (depth < 3) {
      const nested = nestedShellCommand(tokens, i);
      if (nested) {
        const nestedGitPush = detectGitPush(nested, depth + 1);
        if (nestedGitPush) return nestedGitPush;
      }
    }
    if (!isGitExecutableToken(tokens[i])) continue;
    let j = i + 1;
    while (j < tokens.length) {
      const token = tokens[j];
      if (token === "push") {
        const args = tokens.slice(j + 1);
        return {
          hasForce: args.some((arg) => arg === "-f"
            || arg === "--force"
            || arg.startsWith("--force-with-lease")
            || arg.startsWith("+")),
          hasTags: args.includes("--tags") || args.includes("--follow-tags"),
          hasAll: args.includes("--all"),
          hasMirror: args.includes("--mirror"),
        };
      }
      if (token === "--") break;
      if (token.startsWith("-")) {
        j += gitGlobalOptionConsumesValue(token) ? 2 : 1;
        continue;
      }
      break;
    }
  }
  return null;
}

function stagePathsFromRequest(request: any = {}) {
  if (request.toolName !== "stage_files") return [];
  const normalized = normalizeStageFilesParams(request.params);
  return normalized.ok ? normalized.value.filepaths : [];
}

function stageBoundaryBlock(reason?: string) {
  return {
    action: "block",
    code: "ACTION_BLOCKED_BY_WORKSPACE_BOUNDARY",
    reviewer: "safety_policy",
    reason: reason || "Files can only be delivered from the current workspace or an authorized folder.",
    risk: "high",
    ruleIds: ["stage-files-workspace-boundary"],
  };
}

export function prepareStageFilesExecutionParams(request: any = {}, boundary: any = {}) {
  const stagePaths = stagePathsFromRequest(request);
  if (stagePaths.length === 0) return { ok: true, params: request.params } as const;
  if (typeof boundary.checkStagePath !== "function") {
    return { ok: false, error: stageBoundaryBlock("The workspace delivery boundary is unavailable.") } as const;
  }

  const canonicalPaths: string[] = [];
  for (const filePath of stagePaths) {
    const checked = boundary.checkStagePath(filePath);
    const canonicalPath = checked?.canonicalPath;
    if (!checked?.allowed || typeof canonicalPath !== "string" || !canonicalPath) {
      return { ok: false, error: stageBoundaryBlock(checked?.reason) } as const;
    }
    const rechecked = boundary.checkStagePath(canonicalPath);
    if (
      !rechecked?.allowed
      || rechecked.canonicalPath !== canonicalPath
    ) {
      return { ok: false, error: stageBoundaryBlock(rechecked?.reason || "The file target changed during permission validation.") } as const;
    }
    if (!canonicalPaths.includes(canonicalPath)) canonicalPaths.push(canonicalPath);
  }

  const params = { ...(request.params || {}), filepaths: canonicalPaths };
  delete params.filePath;
  Object.defineProperty(params, STAGE_FILES_EXECUTION_BOUNDARY, {
    value: Object.freeze({
      canonicalPaths: Object.freeze([...canonicalPaths]),
      checkStagePath: (filePath: string) => boundary.checkStagePath(filePath),
    }),
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return { ok: true, params } as const;
}

export function evaluateToolSafetyPolicy(request: any = {}, boundary: any = {}) {
  const stagePaths = stagePathsFromRequest(request);
  if (stagePaths.length > 0 && typeof boundary.checkStagePath !== "function") {
    return stageBoundaryBlock("The workspace delivery boundary is unavailable.");
  }
  if (stagePaths.length > 0) {
    for (const filePath of stagePaths) {
      const checked = boundary.checkStagePath(filePath);
      if (!checked?.allowed) {
        return stageBoundaryBlock(checked?.reason);
      }
    }
  }

  const command = commandFromRequest(request);
  if (!command) return null;
  const gitPush = detectGitPush(command);
  if (!gitPush) return null;
  const rule = gitPush.hasForce
    ? GIT_PUSH_RULES.force
    : gitPush.hasMirror
      ? GIT_PUSH_RULES.mirror
      : gitPush.hasAll
        ? GIT_PUSH_RULES.all
        : gitPush.hasTags
          ? GIT_PUSH_RULES.tags
          : null;
  if (!rule) return null;
  return {
    action: "block",
    code: "ACTION_BLOCKED_BY_SAFETY_POLICY",
    reviewer: "safety_policy",
    reason: rule.reason,
    risk: "critical",
    ruleIds: [rule.id],
  };
}
