// Smoke test for a packaged desktop build: launches the app, waits for the
// library, adds a PDF and waits until it's processed (embedded database,
// local embeddings and in-process jobs all working on this OS).
// Usage: node scripts/smoke.cjs <path to the Jobiza executable>
const { _electron } = require("playwright");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PDFDocument, StandardFonts } = require("pdf-lib");

async function makePdf(file) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const page = doc.addPage([595, 842]);
  const text = [
    "Smoke test paper",
    "Sleep after learning strengthens new memories.",
    "Participants who slept recalled more word pairs than those who stayed awake.",
  ];
  text.forEach((line, i) => page.drawText(line, { x: 60, y: 760 - i * 24, size: i ? 12 : 20, font }));
  fs.writeFileSync(file, await doc.save());
}

(async () => {
  const exe = path.resolve(process.argv[2]);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "jobiza-smoke-"));
  const pdf = path.join(home, "smoke-test.pdf");
  await makePdf(pdf);

  // A throwaway profile so the test never touches a real library.
  const env = { ...process.env, JOBIZA_USER_DATA: path.join(home, "profile") };
  const args = process.platform === "linux" ? ["--no-sandbox"] : [];
  const started = Date.now();
  const app = await _electron.launch({ executablePath: exe, args, env, timeout: 120_000 });

  let win;
  for (let i = 0; i < 240 && !win; i++) {
    win = app.windows().find((w) => w.url().startsWith("http"));
    if (!win) await new Promise((r) => setTimeout(r, 500));
  }
  if (!win) throw new Error("The main window never opened.");
  await win.waitForURL(/\/app$/, { timeout: 120_000 });
  await win.getByRole("heading", { name: /Hello/ }).waitFor();
  console.log(`library open after ${Date.now() - started} ms`);

  win.on("response", (r) => r.url().includes("/api/v1/papers") && r.request().method() === "POST" && console.log(`upload: ${r.status()}`));
  win.on("console", (m) => m.type() === "error" && console.log(`console: ${m.text().slice(0, 300)}`));
  await win.goto(win.url().replace(/\/app$/, "/app/library"));
  // Wait for hydration, or the file input has no change handler yet.
  await win.waitForLoadState("networkidle");
  await win.locator('input[type=file][accept*="pdf"]').setInputFiles(pdf);
  await win
    .getByText("Ready", { exact: true })
    .first()
    .waitFor({ timeout: 180_000 })
    .catch(async (err) => {
      await win.screenshot({ path: path.join(process.cwd(), "smoke-failure.png") });
      throw err;
    });
  console.log(`PDF processed after ${Date.now() - started} ms`);
  await win.screenshot({ path: path.join(process.cwd(), "smoke-library.png") });

  // Export a document the way the Export menu does, answering the Save dialog with a path.
  const saveDir = path.join(home, "exports");
  fs.mkdirSync(saveDir);
  await app.evaluate(({ dialog }, target) => {
    dialog.showSaveDialogSync = () => target;
  }, path.join(saveDir, "Smoke export"));
  const docId = await win.evaluate(async () => {
    const res = await fetch("/api/v1/documents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Smoke export" }) });
    return (await res.json()).document.id;
  });
  await win.goto(new URL(`/app/writing/${docId}`, win.url()).href);
  await win.locator(".ProseMirror").click();
  await win.keyboard.type("A sentence to export.");
  await win.getByRole("button", { name: "Export" }).click();
  await win.getByRole("menuitem", { name: "Word (.docx)" }).click();
  const saved = path.join(saveDir, "Smoke export.docx");
  for (let i = 0; i < 60 && !fs.existsSync(saved); i++) await new Promise((r) => setTimeout(r, 500));
  if (!fs.existsSync(saved)) throw new Error(`The export wasn't saved. Files: ${fs.readdirSync(saveDir).join(", ") || "none"}`);
  const head = fs.readFileSync(saved).subarray(0, 2).toString("latin1");
  if (head !== "PK") throw new Error("The saved export isn't a Word document");
  console.log(`export saved after ${Date.now() - started} ms`);

  await app.close();
  const log = fs.readFileSync(fs.readdirSync(home, { recursive: true }).map((f) => path.join(home, String(f))).find((f) => f.endsWith("jobiza.log")), "utf8");
  if (!/server exited with code 0/.test(log)) throw new Error(`The server didn't shut down cleanly:\n${log.slice(-2000)}`);
  console.log("shut down cleanly");
})().catch((err) => {
  console.error("SMOKE TEST FAILED:", err);
  process.exit(1);
});
