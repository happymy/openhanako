import { describe, expect, it, vi } from "vitest";
import {
  buildAtomGitReleasePayload,
  mirrorRelease,
  normalizeUploadUrlPayload,
  parseArgs,
  selectGithubReleases,
} from "../scripts/mirror-release-to-atomgit.mjs";

function githubRelease(tagName: string, prerelease = true) {
  return {
    tag_name: tagName,
    target_commitish: "main",
    name: tagName,
    body: "Release notes",
    draft: false,
    prerelease,
    assets: [
      { name: "latest.yml", size: 120, browser_download_url: "https://example.com/latest.yml" },
      { name: "release-digest.v1.json", size: 240, browser_download_url: "https://example.com/release-digest.v1.json" },
    ],
  };
}

describe("mirror-release-to-atomgit", () => {
  it("defaults manual mirroring to the newest one release", () => {
    expect(parseArgs([], { GITHUB_REPOSITORY: "liliMozi/openhanako" })).toEqual(expect.objectContaining({
      githubOwner: "liliMozi",
      githubRepo: "openhanako",
      atomgitOwner: "liliMozi",
      atomgitRepo: "OpenHanako-Releases",
      selection: "newest",
      latest: 1,
    }));
  });

  it("selects newest published releases from GitHub, including prereleases", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(JSON.stringify([
        githubRelease("v0.425.4", true),
        { ...githubRelease("v0.425.3", false), draft: true },
      ])),
    });

    const releases = await selectGithubReleases({
      githubOwner: "liliMozi",
      githubRepo: "openhanako",
      latest: 1,
    }, { env: {}, fetchImpl });

    expect(releases).toHaveLength(1);
    expect(releases[0].tag_name).toBe("v0.425.4");
  });

  it("can select stable releases without prereleases", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(JSON.stringify([
        githubRelease("v0.425.4", true),
        githubRelease("v0.425.3", true),
        githubRelease("v0.425.2", false),
      ])),
    });

    const releases = await selectGithubReleases({
      githubOwner: "liliMozi",
      githubRepo: "openhanako",
      selection: "stable",
      latest: 1,
    }, { env: {}, fetchImpl });

    expect(releases).toHaveLength(1);
    expect(releases[0].tag_name).toBe("v0.425.2");
  });

  it("preserves prerelease state in the AtomGit release payload", () => {
    expect(buildAtomGitReleasePayload(githubRelease("v0.425.4", true))).toEqual(expect.objectContaining({
      tag_name: "v0.425.4",
      draft: false,
      prerelease: true,
    }));
  });

  it("dry-runs without requiring AtomGit token or uploading assets", async () => {
    const result = await mirrorRelease({ dryRun: true }, githubRelease("v0.425.4"), {
      env: {},
      fetchImpl: vi.fn(),
    });
    expect(result).toEqual({
      tag: "v0.425.4",
      dryRun: true,
      prerelease: true,
      assetNames: ["latest.yml", "release-digest.v1.json"],
    });
  });

  it("normalizes AtomGit upload URL responses from known shapes", () => {
    expect(normalizeUploadUrlPayload({ upload_url: "https://upload.example.com", headers: { "x-token": "a" } })).toEqual({
      uploadUrl: "https://upload.example.com",
      headers: { "x-token": "a" },
    });
    expect(() => normalizeUploadUrlPayload({})).toThrow(/upload URL/);
  });
});
