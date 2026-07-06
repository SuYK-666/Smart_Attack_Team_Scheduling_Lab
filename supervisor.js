import { readFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";

const API_URL = "https://api.deepseek.com/v1/chat/completions";

function getApiKey() {
  try {
    const auth = JSON.parse(readFileSync(
      join(os.homedir(), ".local", "share", "opencode", "auth.json"), "utf-8"
    ));
    return auth.deepseek?.key || "";
  } catch {
    return "";
  }
}

const SYSTEM = `You are a supervisor agent reviewing output from a penetration testing session.

Extract the following structured summary in JSON:

{
  "summary": "one paragraph, max 200 chars: what was done and found this iteration",
  "newFlags": ["flag strings found"],
  "newHosts": ["new IPs or hostnames discovered"],
  "newServices": [{"host":"ip","port":80,"name":"http"}],
  "newCredentials": [{"username":"","password":"","host":"","service":""}],
  "keyActions": ["list of significant actions taken this iteration"],
  "position": "where are you now? e.g. 'local shell on 10.0.0.5 as root' or 'unauthenticated, probing 192.168.1.1'",
  "newAccess": ["what new access did you gain? e.g. 'SSH shell as user www-data on 10.0.0.5'"],
  "intel": ["new valuable intelligence discovered, e.g. 'internal subnet 10.0.0.0/24', 'MySQL on 10.0.0.5:3306', 'backup file at /var/backups/db.sql'"]
}

Rules:
- Flag format: flag{...}, Flag{...}, CTF{...}
- Filter noise — only include NEW discoveries not already known
- If nothing new, return empty arrays and short summary
- position must describe current access level and network location
- newAccess should list specific new access gained (shell, admin panel, credentials, etc)
- intel should list tactical intelligence for further attacks (network topology, services, file paths, hints)
- Be concise but thorough — don't miss valuable intel`;

export async function supervise(output) {
  if (!output || output.trim().length < 50) {
    return { summary: output?.slice(0, 200) || "(empty)", newFlags: [], newHosts: [], newServices: [], newCredentials: [], keyActions: [], position: "", newAccess: [], intel: [] };
  }

  const key = getApiKey();
  if (!key) {
    return basicExtract(output);
  }

  const prompt = `${SYSTEM}

The following is raw output from a penetration testing agent. Extract the structured summary.

RAW OUTPUT:
\`\`\`
${output.slice(-8000)}
\`\`\`

Return ONLY valid JSON (no markdown, no code fences):`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);

    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 1024,
        temperature: 0,
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      throw new Error(`API ${res.status}`);
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || "";

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        summary: parsed.summary || "",
        newFlags: parsed.newFlags || [],
        newHosts: parsed.newHosts || [],
        newServices: parsed.newServices || [],
        newCredentials: parsed.newCredentials || [],
        keyActions: parsed.keyActions || [],
        position: parsed.position || "",
        newAccess: parsed.newAccess || [],
        intel: parsed.intel || [],
      };
    }

    return basicExtract(output);
  } catch (err) {
    console.error(`[supervisor] LLM call failed: ${err.message}, falling back to basic extraction`);
    return basicExtract(output);
  }
}

function basicExtract(output) {
  const flags = [];
  const flagRe = /flag\{[^}]+\}|Flag\{[^}]+\}|CTF\{[^}]+\}/g;
  for (const m of output.matchAll(flagRe)) {
    flags.push(m[0]);
  }

  const hosts = [];
  const hostRe = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/g;
  for (const m of output.matchAll(hostRe)) {
    if (!hosts.includes(m[1]) && !m[1].startsWith("0.") && !m[1].startsWith("127.0.0.1")) {
      hosts.push(m[1]);
    }
  }

  const lineRe = /(?:password|passwd|pass)\s*[:=]\s*(\S+)/gi;
  const creds = [];
  for (const m of output.matchAll(lineRe)) {
    if (m[1].length > 1 && m[1].length < 64) {
      creds.push({ password: m[1] });
    }
  }

  return {
    summary: output.slice(0, 200).replace(/\n/g, " "),
    newFlags: [...new Set(flags)],
    newHosts: hosts,
    newServices: [],
    newCredentials: creds,
    keyActions: [],
    position: "",
    newAccess: [],
    intel: [],
  };
}
