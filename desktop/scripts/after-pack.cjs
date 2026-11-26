// electron-builder hook: copies the server bundle into the packaged app.
// (extraResources always strips node_modules folders, which the server needs.)
// Runs after packing and before the installer is made, so installers include it.
const fs = require("node:fs");
const path = require("node:path");

exports.default = async function afterPack(context) {
  const resources =
    context.electronPlatformName === "darwin"
      ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources")
      : path.join(context.appOutDir, "resources");
  const from = path.join(context.packager.projectDir, "build", "server");
  if (!fs.existsSync(path.join(from, "server.js"))) throw new Error("Run `npm run prepare-server` before packaging.");
  const to = path.join(resources, "server");
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true });
  console.info(`  • copied server bundle to ${path.relative(context.packager.projectDir, to)}`);
};
