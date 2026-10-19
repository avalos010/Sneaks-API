import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    repo: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});

const repository = values.repo ?? execFileSync("gh", [
  "repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner",
], { encoding: "utf8" }).trim();
if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository)) {
  throw new Error("Expected a repository name in owner/repo format");
}

const name = "Require CI before merging";
const ruleset = {
  name,
  target: "branch",
  enforcement: "active",
  conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
  rules: [{
    type: "required_status_checks",
    parameters: {
      required_status_checks: [{ context: "Required checks" }],
      strict_required_status_checks_policy: true,
    },
  }],
};

function api(endpoint: string, method = "GET", body?: unknown): unknown {
  const args = ["api", endpoint, "--method", method];
  if (body !== undefined) args.push("--input", "-");
  const output = execFileSync("gh", args, {
    encoding: "utf8",
    input: body === undefined ? undefined : JSON.stringify(body),
    stdio: ["pipe", "pipe", "inherit"],
  });
  return JSON.parse(output) as unknown;
}

if (values["dry-run"]) {
  console.log(JSON.stringify({ repository, ruleset }, null, 2));
} else {
  const existing = api(`repos/${repository}/rulesets?per_page=100`);
  if (!Array.isArray(existing)) throw new Error("GitHub did not return a ruleset list");
  let id: number | undefined;
  for (const entry of existing) {
    const candidate: unknown = entry;
    if (typeof candidate === "object" && candidate !== null && "name" in candidate
      && candidate.name === name && "id" in candidate && typeof candidate.id === "number") {
      id = candidate.id;
      break;
    }
  }
  const endpoint = `repos/${repository}/rulesets${id === undefined ? "" : `/${id}`}`;
  api(endpoint, id === undefined ? "POST" : "PUT", ruleset);
  console.log(`Enabled Required checks on ${repository}'s default branch. Changes must pass CI and be up to date before merging.`);
}
