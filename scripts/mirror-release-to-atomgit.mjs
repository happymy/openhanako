import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import process from "node:process";
import { pathToFileURL } from "node:url";

const DEFAULT_GITHUB_REPOSITORY = "liliMozi/openhanako";
const DEFAULT_ATOMGIT_OWNER = "liliMozi";
const DEFAULT_ATOMGIT_REPO = "OpenHanako-Releases";
const ATOMGIT_API_BASE = "https://api.gitcode.com/api/v5";

export function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const [defaultGithubOwner, defaultGithubRepo] = (env.GITHUB_REPOSITORY || DEFAULT_GITHUB_REPOSITORY).split("/");
  const args = {
    githubOwner: defaultGithubOwner,
    githubRepo: defaultGithubRepo,
    atomgitOwner: env.ATOMGIT_OWNER || DEFAULT_ATOMGIT_OWNER,
    atomgitRepo: env.ATOMGIT_REPO || DEFAULT_ATOMGIT_REPO,
    tag: null,
    selection: "newest",
    latest: 1,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--github-owner") args.githubOwner = argv[++i];
    else if (arg === "--github-repo") args.githubRepo = argv[++i];
    else if (arg === "--atomgit-owner") args.atomgitOwner = argv[++i];
    else if (arg === "--atomgit-repo") args.atomgitRepo = argv[++i];
    else if (arg === "--tag") args.tag = argv[++i];
    else if (arg === "--newest" || arg === "--latest") {
      args.selection = "newest";
      args.latest = Number.parseInt(argv[++i], 10);
    }
    else if (arg === "--stable") {
      args.selection = "stable";
      args.latest = Number.parseInt(argv[++i], 10);
    }
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isInteger(args.latest) || args.latest < 1 || args.latest > 20) {
    throw new Error("release selection limit must be an integer between 1 and 20");
  }

  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/mirror-release-to-atomgit.mjs [--tag v0.0.0 | --newest 1 | --stable 1] [--dry-run]

Copies GitHub release assets to the matching AtomGit/GitCode release.
Selection:
  --tag v0.0.0  Mirror one exact tag, including prereleases
  --newest N    Mirror the newest non-draft GitHub releases, including prereleases
  --stable N    Mirror the newest non-draft, non-prerelease GitHub releases
Environment:
  GITHUB_TOKEN   Optional for GitHub API rate limits/private assets
  ATOMGIT_TOKEN  Required unless --dry-run
  ATOMGIT_OWNER  Default: ${DEFAULT_ATOMGIT_OWNER}
  ATOMGIT_REPO   Default: ${DEFAULT_ATOMGIT_REPO}
`);
}

function githubHeaders(env) {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(env.GITHUB_TOKEN || env.GH_TOKEN ? { Authorization: `Bearer ${env.GITHUB_TOKEN || env.GH_TOKEN}` } : {}),
  };
}

function atomgitHeaders(env, extra = {}) {
  const token = env.ATOMGIT_TOKEN || env.GITCODE_TOKEN || "";
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}`, "PRIVATE-TOKEN": token } : {}),
    ...extra,
  };
}

function atomgitUrl(pathname, env, params = {}) {
  const token = env.ATOMGIT_TOKEN || env.GITCODE_TOKEN || "";
  const url = new URL(`${ATOMGIT_API_BASE}${pathname}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  if (token) url.searchParams.set("access_token", token);
  return url;
}

async function expectJson(response, label) {
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!response.ok) {
    throw new Error(`${label} failed: ${response.status} ${parsed ? JSON.stringify(parsed) : text}`);
  }
  return parsed;
}

async function githubJson(url, env, fetchImpl) {
  const response = await fetchImpl(url, { headers: githubHeaders(env) });
  return expectJson(response, `GitHub API ${url}`);
}

export async function selectGithubReleases(options, { env = process.env, fetchImpl = fetch } = {}) {
  const base = `https://api.github.com/repos/${options.githubOwner}/${options.githubRepo}`;
  if (options.tag) {
    const release = await githubJson(`${base}/releases/tags/${encodeURIComponent(options.tag)}`, env, fetchImpl);
    if (release.draft) throw new Error(`GitHub release ${options.tag} is still draft`);
    return [release];
  }

  const perPage = options.selection === "stable"
    ? 100
    : Math.min(100, Math.max(5, options.latest * 5));
  const releases = await githubJson(`${base}/releases?per_page=${perPage}&page=1`, env, fetchImpl);
  return releases
    .filter(release => !release.draft)
    .filter(release => options.selection !== "stable" || !release.prerelease)
    .slice(0, options.latest);
}

export function buildAtomGitReleasePayload(githubRelease) {
  return {
    tag_name: githubRelease.tag_name,
    target_commitish: githubRelease.target_commitish || "main",
    name: githubRelease.name || githubRelease.tag_name,
    body: githubRelease.body || "",
    draft: false,
    prerelease: Boolean(githubRelease.prerelease),
  };
}

async function findAtomGitRelease(options, tag, { env, fetchImpl }) {
  const url = atomgitUrl(`/repos/${options.atomgitOwner}/${options.atomgitRepo}/releases/${encodeURIComponent(tag)}`, env);
  const response = await fetchImpl(url, { headers: atomgitHeaders(env) });
  if (response.status === 404 || response.status === 400) return null;
  return expectJson(response, `AtomGit release lookup ${tag}`);
}

async function upsertAtomGitRelease(options, githubRelease, { env, fetchImpl }) {
  const payload = buildAtomGitReleasePayload(githubRelease);
  const existing = await findAtomGitRelease(options, githubRelease.tag_name, { env, fetchImpl });
  const releasePath = existing
    ? `/repos/${options.atomgitOwner}/${options.atomgitRepo}/releases/${encodeURIComponent(githubRelease.tag_name)}`
    : `/repos/${options.atomgitOwner}/${options.atomgitRepo}/releases`;
  const method = existing ? "PATCH" : "POST";
  const response = await fetchImpl(atomgitUrl(releasePath, env), {
    method,
    headers: atomgitHeaders(env),
    body: JSON.stringify(payload),
  });
  return expectJson(response, `AtomGit release ${method} ${githubRelease.tag_name}`);
}

export function normalizeUploadUrlPayload(payload) {
  const uploadUrl = payload?.url || payload?.upload_url || payload?.href;
  if (!uploadUrl || typeof uploadUrl !== "string") {
    throw new Error(`AtomGit upload_url response did not include an upload URL: ${JSON.stringify(payload)}`);
  }
  const headers = payload?.headers && typeof payload.headers === "object" ? payload.headers : {};
  return { uploadUrl, headers };
}

async function getAtomGitUploadTarget(options, tag, asset, { env, fetchImpl }) {
  const response = await fetchImpl(atomgitUrl(
    `/repos/${options.atomgitOwner}/${options.atomgitRepo}/releases/${encodeURIComponent(tag)}/upload_url`,
    env,
    { file_name: asset.name, file_size: asset.size },
  ), { headers: atomgitHeaders(env) });
  const payload = await expectJson(response, `AtomGit upload URL ${asset.name}`);
  return normalizeUploadUrlPayload(payload);
}

async function downloadGithubAsset(asset, destination, { env, fetchImpl }) {
  const response = await fetchImpl(asset.browser_download_url, {
    headers: githubHeaders(env),
    redirect: "follow",
  });
  if (!response.ok || !response.body) {
    throw new Error(`GitHub asset download failed for ${asset.name}: ${response.status} ${await response.text()}`);
  }
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(destination));
}

async function uploadAtomGitAsset(uploadTarget, filePath, asset, fetchImpl) {
  const stat = await fs.promises.stat(filePath);
  const response = await fetchImpl(uploadTarget.uploadUrl, {
    method: "PUT",
    headers: {
      ...uploadTarget.headers,
      "Content-Length": String(stat.size),
      "Content-Type": asset.content_type || "application/octet-stream",
    },
    body: fs.createReadStream(filePath),
    duplex: "half",
  });
  if (!response.ok) {
    throw new Error(`AtomGit asset upload failed for ${asset.name}: ${response.status} ${await response.text()}`);
  }
}

async function mirrorAsset(options, githubRelease, asset, { env, fetchImpl, tempDir }) {
  const filePath = path.join(tempDir, asset.name);
  await downloadGithubAsset(asset, filePath, { env, fetchImpl });
  const uploadTarget = await getAtomGitUploadTarget(options, githubRelease.tag_name, asset, { env, fetchImpl });
  await uploadAtomGitAsset(uploadTarget, filePath, asset, fetchImpl);
}

export async function mirrorRelease(options, githubRelease, { env = process.env, fetchImpl = fetch } = {}) {
  if (!options.dryRun && !(env.ATOMGIT_TOKEN || env.GITCODE_TOKEN)) {
    throw new Error("ATOMGIT_TOKEN is required unless --dry-run is set");
  }

  const assetNames = (githubRelease.assets || []).map(asset => asset.name);
  if (options.dryRun) {
    return {
      tag: githubRelease.tag_name,
      dryRun: true,
      prerelease: Boolean(githubRelease.prerelease),
      assetNames,
    };
  }

  await upsertAtomGitRelease(options, githubRelease, { env, fetchImpl });
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `hana-atomgit-${githubRelease.tag_name}-`));
  try {
    for (const asset of githubRelease.assets || []) {
      console.log(`Uploading ${githubRelease.tag_name}/${asset.name}`);
      await mirrorAsset(options, githubRelease, asset, { env, fetchImpl, tempDir });
    }
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }

  return {
    tag: githubRelease.tag_name,
    dryRun: false,
    prerelease: Boolean(githubRelease.prerelease),
    assetNames,
  };
}

export async function run(argv = process.argv.slice(2), { env = process.env, fetchImpl = fetch } = {}) {
  const args = parseArgs(argv, env);
  if (args.help) {
    printHelp();
    return;
  }

  const releases = await selectGithubReleases(args, { env, fetchImpl });
  if (releases.length === 0) {
    throw new Error("No published GitHub releases matched the requested selection");
  }

  const summaries = [];
  for (const release of releases) {
    console.log(`${args.dryRun ? "Would mirror" : "Mirroring"} ${release.tag_name} (${release.assets?.length || 0} assets)`);
    summaries.push(await mirrorRelease(args, release, { env, fetchImpl }));
  }
  console.log(JSON.stringify({ mirrored: summaries }, null, 2));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  run().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
}
