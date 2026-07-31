import { execFileSync } from "node:child_process";

const context = process.env.CONTEXT ?? "";

if (context === "production") {
  let commitMessage = process.env.COMMIT_MESSAGE ?? "";
  if (!commitMessage) {
    try {
      commitMessage = execFileSync("git", ["log", "-1", "--pretty=%B"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      commitMessage = "";
    }
  }

  if (!commitMessage.includes("[deploy-production]")) {
    console.log("Build principal bloqueado: falta autorização explícita no commit.");
    process.exit(0);
  }

  console.log("Build principal autorizado explicitamente para este commit.");
}

process.exit(1);
