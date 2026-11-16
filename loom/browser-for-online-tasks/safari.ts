// Minimal Safari WebDriver helper. See README.md and README.md beside this file.
// Plain JS inside a .ts file on purpose: nothing to type-strip wrongly when loadTools loads it.
let child = null;
let base = "";
let sid = null;

async function req(path, init) {
  const r = await fetch(
    base + path,
    Object.assign({ signal: AbortSignal.timeout(20000) }, init || {}),
  );
  const t = await r.text();
  let body = t;
  try {
    body = JSON.parse(t);
  } catch { /* non-JSON body */ }
  const v = body && typeof body === "object" && "value" in body ? body.value : body;
  if (v && typeof v === "object" && v.error) throw new Error(v.error + ": " + (v.message || ""));
  return v;
}

export async function open(port) {
  if (child) return "already open on " + base;
  const p = String(port || 4455);
  base = "http://127.0.0.1:" + p;
  child = new Deno.Command("safaridriver", {
    args: ["--port=" + p],
    stdout: "null",
    stderr: "piped",
  }).spawn();
  for (let i = 0; i < 40; i++) {
    await new Promise((res) => setTimeout(res, 250));
    try {
      const s = await req("/status");
      if (s && s.ready) return "ready";
    } catch { /* not up yet */ }
  }
  throw new Error(
    "safaridriver never became ready - when Safari refuses, its message names the missing setting: Safari > Develop > Allow Remote Automation",
  );
}

export async function newSession() {
  const v = await req("/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ capabilities: { alwaysMatch: { browserName: "safari" } } }),
  });
  sid = v.sessionId;
  return v.capabilities ? v.capabilities.browserVersion : sid;
}

export async function goto(url, settleMs) {
  await req("/session/" + sid + "/url", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: url }),
  });
  await new Promise((res) => setTimeout(res, settleMs || 2500));
  return true;
}

// WebDriver wraps this as a FUNCTION BODY: return explicitly or the answer is null.
export async function js(script) {
  return await req("/session/" + sid + "/execute/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ script: script, args: [] }),
  });
}

export async function text(selector) {
  const s = selector
    ? "return (document.querySelector(" + JSON.stringify(selector) + ") || {}).innerText || null;"
    : "return document.body.innerText;";
  return await js(s);
}

export async function find(selector) {
  return await req("/session/" + sid + "/element", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ using: "css selector", value: selector }),
  });
}

export async function click(selector) {
  const eid = await find(selector);
  return await req("/session/" + sid + "/element/" + eid + "/click", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
}

export async function type(selector, value) {
  const eid = await find(selector);
  await req("/session/" + sid + "/element/" + eid + "/value", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: String(value) }),
  });
  return true;
}

export async function shot(path) {
  const b64 = await req("/session/" + sid + "/screenshot");
  await Deno.writeFile(path, Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
  return path;
}

export async function close() {
  if (sid) {
    try {
      await req("/session/" + sid, { method: "DELETE" });
    } catch { /* gone */ }
    sid = null;
  }
  if (child) {
    try {
      child.kill("SIGTERM");
      await child.status;
    } catch { /* gone */ }
    child = null;
  }
  return true;
}

export function dispose() {
  return close();
}
