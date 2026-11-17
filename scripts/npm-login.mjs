#!/usr/bin/env node
// Logs npm in to GitHub Packages, so `npm install` / `npm ci` can fetch the private UI library @darkblackside/ui
// (repository darkblackside/bm-ui-kit), used by the demo pages. Run once per machine, and again when the token expires:
//
//   npm run login:npm              GitHub CLI token if `gh` is installed, otherwise asks for a classic token
//   npm run login:npm -- --check   only check the stored token
//
// The token goes into your user ~/.npmrc (never into this repository), so every project on this machine that uses
// @darkblackside/ui shares it. This repository's .npmrc only maps @darkblackside to the registry.
import { spawnSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import readline from "node:readline";

const REGISTRY_HOST = "npm.pkg.github.com";
const AUTH_KEY = `//${REGISTRY_HOST}/:_authToken`;
const PACKAGE = "@darkblackside/ui";
const TOKEN_PAGE =
  "https://github.com/settings/tokens/new?scopes=read:packages&description=" +
  encodeURIComponent("npm: GitHub Packages (@darkblackside)");

const userconfig = process.env.NPM_CONFIG_USERCONFIG || process.env.npm_config_userconfig || join(homedir(), ".npmrc");
const checkOnly = process.argv.includes("--check");

const ok = (msg) => console.log(`✓ ${msg}`);
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

/** The stored token from the user .npmrc, if any. */
function storedToken() {
  if (!existsSync(userconfig)) return undefined;
  for (const line of readFileSync(userconfig, "utf8").split(/\r?\n/)) {
    const [key, ...rest] = line.split("=");
    if (key?.trim() === AUTH_KEY) return rest.join("=").trim();
  }
  return undefined;
}

/** Replaces (or adds) the token line in the user .npmrc and leaves every other line alone. */
function storeToken(token) {
  const lines = existsSync(userconfig) ? readFileSync(userconfig, "utf8").split(/\r?\n/) : [];
  const kept = lines.filter((l) => l.split("=")[0]?.trim() !== AUTH_KEY);
  while (kept.length && kept.at(-1) === "") kept.pop();
  kept.push(`${AUTH_KEY}=${token}`, "");
  writeFileSync(userconfig, kept.join("\n"), { mode: 0o600 });
}

/** Checks the token against GitHub: valid, classic (fine-grained tokens cannot use the npm registry), read:packages. */
async function verify(token) {
  if (token.startsWith("github_pat_")) {
    return { error: "This is a fine-grained token. GitHub Packages (npm) only accepts classic tokens (ghp_…) or gh tokens." };
  }
  const res = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": "npm-login-script", Accept: "application/vnd.github+json" },
  });
  if (res.status === 401) return { error: "GitHub rejects the token (invalid or expired)." };
  if (!res.ok) return { error: `GitHub API answered ${res.status} ${res.statusText}.` };
  const login = (await res.json()).login;
  const scopes = (res.headers.get("x-oauth-scopes") ?? "").split(",").map((s) => s.trim());
  const canRead = scopes.includes("read:packages") || scopes.includes("write:packages");
  return { login, canRead };
}

/** Can the token see the package? (404 before the first release or without access to darkblackside/bm-ui-kit.) */
async function packageVersion(token) {
  const res = await fetch(`https://${REGISTRY_HOST}/${PACKAGE.replace("/", "%2f")}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return { status: res.status };
  const doc = await res.json();
  return { status: res.status, latest: doc["dist-tags"]?.latest };
}

function hasGh() {
  return spawnSync("gh", ["--version"], { stdio: "ignore" }).status === 0;
}

function ghToken() {
  const r = spawnSync("gh", ["auth", "token", "-h", "github.com"], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : undefined;
}

function openBrowser(url) {
  const [cmd, args] =
    process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
  } catch {
    // printing the URL is enough
  }
}

/** Reads a line without echoing it (the token). */
function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
    let muted = false;
    rl._writeToOutput = (s) => {
      if (!muted) process.stdout.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      if (process.stdin.isTTY) process.stdout.write("\n");
      resolve(answer.trim());
    });
    muted = true;
  });
}

async function report(token) {
  const pkg = await packageVersion(token);
  if (pkg.status === 200) ok(`${PACKAGE} is reachable (latest ${pkg.latest ?? "?"}). npm install will work.`);
  else
    console.warn(
      `! ${PACKAGE} is not visible to this token (HTTP ${pkg.status}): it has not been published yet, ` +
        `or your account has no access to darkblackside/bm-ui-kit.`,
    );
}

// ---- --check ----------------------------------------------------------------------------------------------------
if (checkOnly) {
  const token = storedToken();
  if (!token) fail(`No token for ${REGISTRY_HOST} in ${userconfig}. Run: npm run login:npm`);
  const v = await verify(token);
  if (v.error) fail(`${v.error} Run: npm run login:npm`);
  if (!v.canRead) fail(`The stored token (${v.login}) lacks the read:packages scope. Run: npm run login:npm`);
  ok(`Stored token belongs to ${v.login} and has read:packages (${userconfig}).`);
  await report(token);
  process.exit(0);
}

// ---- login ------------------------------------------------------------------------------------------------------
let token;
if (hasGh()) {
  token = ghToken();
  if (!token) {
    console.log("Logging in to GitHub with the GitHub CLI (with the read:packages scope) …");
    spawnSync("gh", ["auth", "login", "-h", "github.com", "-s", "read:packages", "-w"], { stdio: "inherit" });
    token = ghToken();
  } else {
    const v = await verify(token);
    if (!v.error && !v.canRead) {
      console.log("Your gh login lacks read:packages; adding it (confirm in the browser) …");
      spawnSync("gh", ["auth", "refresh", "-h", "github.com", "-s", "read:packages"], { stdio: "inherit" });
      token = ghToken();
    }
  }
  if (!token) fail("Could not get a token from gh.");
} else {
  console.log(
    [
      "The GitHub CLI (gh) is not installed, so this needs a classic personal access token with read:packages.",
      "Opening the page that creates one (scope already ticked; choose an expiry, then 'Generate token'):",
      "",
      `  ${TOKEN_PAGE}`,
      "",
    ].join("\n"),
  );
  openBrowser(TOKEN_PAGE);
  token = await askHidden("Paste the token (ghp_…), input is hidden: ");
  if (!token) fail("No token entered.");
}

const v = await verify(token);
if (v.error) fail(v.error);
if (!v.canRead) fail(`The token (${v.login}) lacks the read:packages scope. Create one with it: ${TOKEN_PAGE}`);
ok(`Token belongs to ${v.login} and has read:packages.`);

storeToken(token);
ok(`Stored in ${userconfig} (${AUTH_KEY}).`);
await report(token);
