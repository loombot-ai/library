// Chrome over CDP - no driver binary, no WebDriver flag. See README.md beside this file.
let proc = null;
let ws = null;
let msgId = 0;
const pending = new Map();
let port = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve: resolve, reject: reject });
    ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error("timeout " + method));
      }
    }, 30000);
  });
}

export async function launch(opts) {
  const o = opts || {};
  port = o.port || 9333;
  const prof = o.profileDir || ((Deno.env.get("TMPDIR") || "/tmp") + "/chrome-cdp-profile");
  const args = [
    "--remote-debugging-port=" + port,
    "--user-data-dir=" + prof,
    "--no-first-run",
    "--no-default-browser-check",
  ];
  if (o.headless) args.push("--headless=new");
  else args.push("--window-size=1280,900");
  args.push(o.url || "about:blank");
  proc = new Deno.Command(CHROME, { args: args, stdout: "null", stderr: "null" }).spawn();
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    try {
      const r = await fetch("http://127.0.0.1:" + port + "/json/version");
      if (r.ok) {
        const v = await r.json();
        return v["Browser"] || "chrome";
      }
    } catch { /* nothing to do */ }
  }
  throw new Error("chrome never exposed a debugging port");
}

export async function attach() {
  let r = await fetch("http://127.0.0.1:" + port + "/json/new?about:blank", { method: "PUT" });
  if (!r.ok) r = await fetch("http://127.0.0.1:" + port + "/json/new?about:blank");
  const t = await r.json();
  ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = () => res(true);
    ws.onerror = () => rej(new Error("websocket refused"));
  });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error.message));
      else p.resolve(m.result);
    }
  };
  await rpc("Page.enable", {});
  await rpc("Runtime.enable", {});
  return t.id || true;
}

export async function goto(url, settleMs) {
  await rpc("Page.navigate", { url: url });
  await sleep(settleMs || 3000);
  return true;
}

export async function ev(expression) {
  const r = await rpc("Runtime.evaluate", {
    expression: expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.exceptionDetails) {
    throw new Error("page threw: " + JSON.stringify(r.exceptionDetails).slice(0, 300));
  }
  return r.result ? r.result.value : null;
}

export async function wait(ms) {
  return await ev("new Promise(function(r){setTimeout(function(){r(true)}, " + ms + ")})");
}

export async function shot(path) {
  const r = await rpc("Page.captureScreenshot", { format: "png" });
  await Deno.writeFile(path, Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0)));
  return path;
}

export async function close() {
  if (ws) {
    try {
      ws.close();
    } catch { /* nothing to do */ }
    ws = null;
  }
  if (proc) {
    try {
      proc.kill("SIGTERM");
      await proc.status;
    } catch { /* nothing to do */ }
    proc = null;
  }
  return true;
}

export function dispose() {
  return close();
}
