"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { getTempFilePath } = require("../electron/bridges/tempDirBridge.cjs");

function command(bin, args) {
  return execFileSync(bin, args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
}

async function hashFile(file) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

function parseChecksums(text) {
  const checksums = new Map();
  for (const line of text.trim().split(/\r?\n/)) {
    if (!line) continue;
    const match = /^([a-f0-9]{64})\s+\*?([^/\\]+)$/.exec(line);
    if (!match) throw new Error("Invalid published checksum entry");
    if (checksums.has(match[2])) throw new Error("Duplicate published checksum entry");
    checksums.set(match[2], match[1]);
  }
  return checksums;
}

async function main() {
  const directory = path.resolve(process.argv[2] || "packages");
  const version = process.env.PERSONAL_VERSION
    || require("../electron-builder.personal.config.cjs").extraMetadata.version;
  if (!/^\d+\.\d+\.\d+-C[1-9]\d*$/.test(version)) throw new Error("Invalid personal version");
  const tag = `v${version}`;
  const repo = process.env.GH_REPO || "caspar94/Netcatty";
  const source = process.env.GITHUB_SHA || command("git", ["rev-parse", "HEAD"]).trim();
  const files = fs.readdirSync(directory).filter(name => (
    name.startsWith(`Netcatty-${version}-`)
    && /\.(?:dmg|zip|exe|AppImage|deb|rpm|pacman)$/.test(name)
    && fs.statSync(path.join(directory, name)).isFile()
  )).sort();
  if (!files.length) throw new Error("No installable personal packages found");

  let release = null;
  try {
    release = JSON.parse(command("gh", ["release", "view", tag, "--repo", repo,
      "--json", "assets,isDraft,body"]));
  } catch (error) {
    const detail = `${error.stderr || ""} ${error.message || ""}`;
    if (!/release not found|HTTP 404|Not Found/i.test(detail)) throw error;
  }
  if (release?.isDraft) throw new Error("Existing release is a draft; finish or inspect it before adding packages");
  const published = new Set((release?.assets || []).map(asset => asset.name));
  const missing = files.filter(name => !published.has(name));
  if (!missing.length) {
    console.log(`${tag}: all platform packages already exist; this commit remains available in Actions artifacts.`);
    return;
  }
  if (release) {
    // Adding platforms to C1 is allowed only while application source still
    // matches the original tag. Never attach changed application code to it.
    command("git", ["diff", "--exit-code", tag, "--", ".",
      ":(exclude).github/workflows/personal-build.yml",
      ":(exclude)electron-builder.personal.config.cjs",
      ":(exclude)docs/personal-build.md",
      ":(exclude)scripts/publish-personal-release.cjs",
      ":(exclude)scripts/personal-release.test.cjs"]);
  }
  console.log(JSON.stringify({ tag, source, add: missing, preserve: [...published] }, null, 2));
  if (process.argv.includes("--check")) return;

  const temporary = fs.mkdtempSync(`${getTempFilePath("personal-release")}-`);
  try {
    let checksums = new Map();
    if (release) {
      const existing = path.join(temporary, "existing-checksums");
      command("gh", ["release", "download", tag, "--repo", repo,
        "--pattern", "SHA256SUMS", "--output", existing]);
      checksums = parseChecksums(fs.readFileSync(existing, "utf8"));
      for (const name of published) {
        if (/\.(?:dmg|zip|exe|AppImage|deb|rpm|pacman)$/.test(name) && !checksums.has(name)) {
          throw new Error(`Published package has no checksum: ${name}`);
        }
      }
    }
    for (const name of missing) checksums.set(name, await hashFile(path.join(directory, name)));
    const checksumPath = path.join(temporary, "SHA256SUMS");
    fs.writeFileSync(checksumPath, [...checksums].sort(([a], [b]) => a.localeCompare(b))
      .map(([name, hash]) => `${hash}  ${name}\n`).join(""));
    const buildUrl = process.env.GITHUB_RUN_ID
      ? `https://github.com/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}` : source;
    const platformNotes = `\n\nAdditional platform packages built from ${source}:\n`
      + missing.map(name => `- ${name}`).join("\n")
      + `\n\nBuild: ${buildUrl}\nExisting package files and the version tag are preserved. SHA256SUMS covers all published packages.\n`;
    const notes = path.join(temporary, "notes.md");
    if (release) {
      command("gh", ["release", "upload", tag, ...missing.map(name => path.join(directory, name)), "--repo", repo]);
      // Only the combined manifest is replaced; installers are never clobbered.
      command("gh", ["release", "upload", tag, checksumPath, "--repo", repo, "--clobber"]);
      fs.writeFileSync(notes, release.body + platformNotes);
      command("gh", ["release", "edit", tag, "--repo", repo, "--notes-file", notes]);
    } else {
      fs.writeFileSync(notes, `Personal Netcatty ${version}, built by GitHub Actions from ${source}.\n\n`
        + "Includes terminal, tab-switching, AI rendering, streaming, and asynchronous authentication optimizations.\n\n"
        + "macOS: arm64 for Apple Silicon, x64 for Intel (ad-hoc signed, not notarized).\n"
        + "Windows: x64 installer, portable EXE and ZIP.\nLinux: x64 and arm64 AppImage, DEB, RPM and pacman.\n"
        + `\nBuild: ${buildUrl}\n\nIncrement the C revision to publish changed application code.\n`);
      command("gh", ["release", "create", tag, ...missing.map(name => path.join(directory, name)),
        checksumPath, "--repo", repo, "--target", source, "--title", `Netcatty ${version}`,
        "--notes-file", notes, "--prerelease"]);
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { parseChecksums };
