#!/usr/bin/env node
const { execSync } = require("node:child_process");

const args = process.argv.slice(2);
const stagedIndex = args.indexOf("--staged");
const extraArgs = stagedIndex !== -1 ? args.filter((arg) => arg !== "--staged") : args;
const baseCommand = stagedIndex !== -1 ? "git diff --cached" : "git diff";
const command = extraArgs.length > 0 ? `${baseCommand} ${extraArgs.join(" ")}` : baseCommand;

let rawDiff = "";
try {
  rawDiff = execSync(command, { encoding: "utf8" });
} catch (error) {
  if (error.stdout) {
    rawDiff = error.stdout.toString();
  } else {
    throw error;
  }
}

const processed = rawDiff
  .split("\n")
  .map((line) => {
    if (line.startsWith("+++ ") || line.startsWith("--- ") || line.startsWith("@@")) {
      return line;
    }
    if (line.startsWith("+")) {
      return `追加: ${line.slice(1)}`;
    }
    if (line.startsWith("-")) {
      return `削除: ${line.slice(1)}`;
    }
    return line;
  })
  .join("\n");

process.stdout.write(processed);
