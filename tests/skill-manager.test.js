import { describe, expect, it, beforeEach } from "vitest";
import { SkillManager } from "../core/skill-manager.js";

function makeAgent(id, enabled = []) {
  return { id, config: { skills: { enabled } } };
}

function makeSkill(name, overrides = {}) {
  return { name, source: "user", description: `${name} skill`, filePath: `/skills/${name}/SKILL.md`, baseDir: `/skills/${name}`, _hidden: false, _readonly: false, ...overrides };
}

describe("SkillManager._skillsVisibleToAgent", () => {
  let sm;

  beforeEach(() => {
    sm = new SkillManager({ skillsDir: "/tmp/hana-test-skills" });
  });

  it("returns global skills for any agent", () => {
    sm._allSkills = [makeSkill("pdf"), makeSkill("docx")];
    const agentA = makeAgent("agent-a");
    expect(sm._skillsVisibleToAgent(agentA).map(s => s.name)).toEqual(["pdf", "docx"]);
  });

  it("returns learned skills only to their owning agent", () => {
    sm._allSkills = [
      makeSkill("global-skill"),
      makeSkill("learned-a", { source: "learned", _agentId: "agent-a" }),
      makeSkill("learned-b", { source: "learned", _agentId: "agent-b" }),
    ];
    const agentA = makeAgent("agent-a");
    const agentB = makeAgent("agent-b");

    const visibleA = sm._skillsVisibleToAgent(agentA).map(s => s.name);
    const visibleB = sm._skillsVisibleToAgent(agentB).map(s => s.name);

    expect(visibleA).toEqual(["global-skill", "learned-a"]);
    expect(visibleB).toEqual(["global-skill", "learned-b"]);
  });

  it("excludes plugin skills by default", () => {
    sm._allSkills = [makeSkill("pdf"), makeSkill("plugin-x", { _pluginSkill: true })];
    expect(sm._skillsVisibleToAgent(makeAgent("a")).map(s => s.name)).toEqual(["pdf"]);
  });

  it("includes plugin skills when requested", () => {
    sm._allSkills = [makeSkill("pdf"), makeSkill("plugin-x", { _pluginSkill: true })];
    expect(sm._skillsVisibleToAgent(makeAgent("a"), { includePlugin: true }).map(s => s.name)).toEqual(["pdf", "plugin-x"]);
  });

  it("excludes workspace skills by default", () => {
    sm._allSkills = [makeSkill("pdf"), makeSkill("ws-skill", { _workspaceSkill: true })];
    expect(sm._skillsVisibleToAgent(makeAgent("a")).map(s => s.name)).toEqual(["pdf"]);
  });

  it("includes workspace skills when requested", () => {
    sm._allSkills = [makeSkill("pdf"), makeSkill("ws-skill", { _workspaceSkill: true })];
    expect(sm._skillsVisibleToAgent(makeAgent("a"), { includeWorkspace: true }).map(s => s.name)).toEqual(["pdf", "ws-skill"]);
  });
});

describe("SkillManager.getAllSkills — per-agent isolation", () => {
  let sm;

  beforeEach(() => {
    sm = new SkillManager({ skillsDir: "/tmp/hana-test-skills" });
    sm._allSkills = [
      makeSkill("global-skill"),
      makeSkill("learned-a", { source: "learned", _agentId: "agent-a" }),
      makeSkill("learned-b", { source: "learned", _agentId: "agent-b" }),
      makeSkill("plugin-x", { _pluginSkill: true }),
      makeSkill("ws-skill", { _workspaceSkill: true }),
    ];
  });

  it("does not leak agent-b learned skills to agent-a", () => {
    const result = sm.getAllSkills(makeAgent("agent-a", ["global-skill", "learned-a"]));
    const names = result.map(s => s.name);
    expect(names).toContain("global-skill");
    expect(names).toContain("learned-a");
    expect(names).not.toContain("learned-b");
  });

  it("excludes plugin and workspace skills", () => {
    const result = sm.getAllSkills(makeAgent("agent-a"));
    const names = result.map(s => s.name);
    expect(names).not.toContain("plugin-x");
    expect(names).not.toContain("ws-skill");
  });
});

describe("SkillManager.getRuntimeSkillInfos — per-agent isolation", () => {
  let sm;

  beforeEach(() => {
    sm = new SkillManager({ skillsDir: "/tmp/hana-test-skills" });
    sm._allSkills = [
      makeSkill("global-skill"),
      makeSkill("learned-a", { source: "learned", _agentId: "agent-a" }),
      makeSkill("learned-b", { source: "learned", _agentId: "agent-b" }),
      makeSkill("ws-skill", { _workspaceSkill: true }),
    ];
  });

  it("does not leak agent-b learned skills to agent-a", () => {
    const result = sm.getRuntimeSkillInfos(makeAgent("agent-a"));
    const names = result.map(s => s.name);
    expect(names).toContain("global-skill");
    expect(names).toContain("learned-a");
    expect(names).not.toContain("learned-b");
  });

  it("includes workspace skills", () => {
    const result = sm.getRuntimeSkillInfos(makeAgent("agent-a"));
    expect(result.map(s => s.name)).toContain("ws-skill");
  });
});

describe("SkillManager.syncAgentSkills — per-agent isolation", () => {
  let sm;

  beforeEach(() => {
    sm = new SkillManager({ skillsDir: "/tmp/hana-test-skills" });
    sm._allSkills = [
      makeSkill("shared-name", { source: "user" }),
      makeSkill("shared-name", { source: "learned", _agentId: "agent-a" }),
      makeSkill("shared-name", { source: "learned", _agentId: "agent-b" }),
    ];
  });

  it("does not inject agent-b learned skill into agent-a", () => {
    let injected = [];
    const fakeAgent = {
      id: "agent-a",
      config: { skills: { enabled: ["shared-name"] } },
      setEnabledSkills(skills) { injected = skills; },
    };
    sm.syncAgentSkills(fakeAgent);

    const agentIds = injected.filter(s => s._agentId).map(s => s._agentId);
    expect(agentIds).not.toContain("agent-b");
  });
});

describe("SkillManager.getSkillsForAgent — baseline (unchanged)", () => {
  let sm;

  beforeEach(() => {
    sm = new SkillManager({ skillsDir: "/tmp/hana-test-skills" });
    sm._allSkills = [
      makeSkill("global-skill"),
      makeSkill("learned-a", { source: "learned", _agentId: "agent-a" }),
      makeSkill("learned-b", { source: "learned", _agentId: "agent-b" }),
      makeSkill("plugin-x", { _pluginSkill: true }),
    ];
  });

  it("filters learned skills by agentId and includes plugins", () => {
    const agentA = makeAgent("agent-a", ["global-skill", "learned-a", "plugin-x"]);
    const result = sm.getSkillsForAgent(agentA);
    const names = result.skills.map(s => s.name);
    expect(names).toContain("global-skill");
    expect(names).toContain("learned-a");
    expect(names).toContain("plugin-x");
    expect(names).not.toContain("learned-b");
  });
});

describe("SkillManager.computeDefaultEnabledForNewAgent", () => {
  let sm;

  beforeEach(() => {
    sm = new SkillManager({ skillsDir: "/tmp/hana-test-skills" });
  });

  it("includes user source skills", () => {
    sm._allSkills = [
      { name: "pdf", source: "user" },
      { name: "docx", source: "user" },
    ];
    expect(sm.computeDefaultEnabledForNewAgent()).toEqual(["pdf", "docx"]);
  });

  it("excludes learned source skills", () => {
    sm._allSkills = [
      { name: "pdf", source: "user" },
      { name: "my-learned", source: "learned", _agentId: "agent-a" },
    ];
    expect(sm.computeDefaultEnabledForNewAgent()).toEqual(["pdf"]);
  });

  it("excludes external source skills (covers plugin and workspace sub-categories)", () => {
    sm._allSkills = [
      { name: "pdf", source: "user" },
      { name: "ext-plain", source: "external" },
      { name: "plugin-skill", source: "external", _pluginSkill: true },
      { name: "workspace-skill", source: "external", _workspaceSkill: true },
    ];
    expect(sm.computeDefaultEnabledForNewAgent()).toEqual(["pdf"]);
  });

  it("excludes skills that opt out of default enablement", () => {
    sm._allSkills = [
      { name: "pdf", source: "user" },
      { name: "hana-plugin-creator", source: "user", defaultEnabled: false },
    ];
    expect(sm.computeDefaultEnabledForNewAgent()).toEqual(["pdf"]);
  });

  it("returns empty array when _allSkills is empty", () => {
    sm._allSkills = [];
    expect(sm.computeDefaultEnabledForNewAgent()).toEqual([]);
  });

  it("preserves skill order from _allSkills", () => {
    sm._allSkills = [
      { name: "a", source: "user" },
      { name: "b", source: "learned", _agentId: "x" },
      { name: "c", source: "user" },
    ];
    expect(sm.computeDefaultEnabledForNewAgent()).toEqual(["a", "c"]);
  });
});
