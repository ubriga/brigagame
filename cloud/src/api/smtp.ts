/* Created by OrelAI - Brigagame 2.0 (https://github.com/ubriga/brigagame) */
// Minimal SMTP-over-TLS client (RFC 5321 subset) for Cloudflare Workers.
// Used for the game Gmail (smtp.gmail.com): port 465, direct TLS, AUTH LOGIN with an app password.
import { connect } from "cloudflare:sockets";

function b64(s: string): string {
  return btoa(unescape(encodeURIComponent(s)));
}

export async function sendSmtpMail(opts: {
  host: string; port: number; user: string; pass: string;
  from: string; to: string; subject: string; text: string;
  html?: string; headers?: Record<string, string>; fromName?: string;
}): Promise<{ ok: boolean; error?: string; permanent?: boolean }> {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  let socket: any = null;
  try {
    socket = connect({ hostname: opts.host, port: opts.port },
      { secureTransport: "on" } as any);
    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();
    let buf = "";
    const readReply = async (): Promise<{ code: number; body: string }> => {
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        const m = buf.match(/^(\d{3}) [^\r\n]*\r?\n/m);
        if (m) {
          const body = buf.slice(0, (m.index ?? 0) + m[0].length);
          buf = buf.slice((m.index ?? 0) + m[0].length);
          return { code: parseInt(m[1], 10), body };
        }
        const read = await Promise.race([
          reader.read(),
          new Promise((_, rej) => setTimeout(() => rej(new Error("smtp read timeout")),
            Math.max(1, deadline - Date.now()))),
        ]) as any;
        if (read.done) throw new Error("smtp connection closed: " + buf.slice(0, 120));
        buf += dec.decode(read.value, { stream: true });
      }
      throw new Error("smtp read timeout");
    };
    const send = async (line: string) => { await writer.write(enc.encode(line + "\r\n")); };
    const expect = async (want: number[], what: string) => {
      const r = await readReply();
      if (!want.includes(r.code))
        throw new Error(what + " -> " + r.code + " " + r.body.replace(/\s+/g, " ").slice(0, 120));
    };

    await expect([220], "banner");
    await send("EHLO brigagame.ubriga.workers.dev");
    await expect([250], "EHLO");
    await send("AUTH LOGIN");
    await expect([334], "AUTH LOGIN");
    await send(b64(opts.user));
    await expect([334], "AUTH user");
    await send(b64(opts.pass));
    await expect([235], "AUTH pass");
    await send("MAIL FROM:<" + opts.from + ">");
    await expect([250], "MAIL FROM");
    await send("RCPT TO:<" + opts.to + ">");
    {
      const r = await readReply();
      if (r.code >= 550 && r.code <= 553) {
        try { await send("QUIT"); } catch { /* closing */ }
        try { await socket.close(); } catch { /* closing */ }
        return { ok: false, permanent: true, error: "RCPT TO -> " + r.code };
      }
      if (![250, 251].includes(r.code))
        throw new Error("RCPT TO -> " + r.code + " " + r.body.replace(/\s+/g, " ").slice(0, 120));
    }
    await send("DATA");
    await expect([354], "DATA");
    const nl = "\r\n";
    const wrap = (t: string) => b64(t).replace(/.{1,76}/g, "$&" + nl);
    const extra = Object.entries(opts.headers ?? {}).map(([k, v]) => k + ": " + v + nl).join("");
    const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" } as any)[c]);
    const html = opts.html ?? ('<div dir="rtl" style="font-family:Arial,sans-serif;font-size:16px;line-height:1.6;color:#111">'
      + esc(opts.text).split(/\n{2,}/).map((p) => "<p>" + p.replace(/\n/g, "<br>") + "</p>").join("") + "</div>");
    const domain = (opts.from.split("@")[1] || "gmail.com");
    const msgId = "<" + crypto.randomUUID().replaceAll("-", "") + "@" + domain + ">";
    const head =
      "Date: " + new Date().toUTCString().replace("GMT", "+0000") + nl +
      "From: " + (opts.fromName ?? "Brigagame 2.0") + " <" + opts.from + ">" + nl +
      "To: <" + opts.to + ">" + nl +
      "Reply-To: " + (opts.fromName ?? "Brigagame 2.0") + " <" + opts.from + ">" + nl +
      "Message-ID: " + msgId + nl +
      "Subject: =?UTF-8?B?" + b64(opts.subject) + "?=" + nl +
      "MIME-Version: 1.0" + nl + extra;
    const bd = "bg_" + crypto.randomUUID().replaceAll("-", "");
    const msg = head + "Content-Type: multipart/alternative; boundary=\"" + bd + "\"" + nl + nl +
      "--" + bd + nl + "Content-Type: text/plain; charset=UTF-8" + nl + "Content-Transfer-Encoding: base64" + nl + nl + wrap(opts.text) +
      "--" + bd + nl + "Content-Type: text/html; charset=UTF-8" + nl + "Content-Transfer-Encoding: base64" + nl + nl + wrap(html) +
      "--" + bd + "--" + nl + ".";
    await writer.write(enc.encode(msg + nl));
    await expect([250], "message body");
    await send("QUIT");
    try { await readReply(); } catch { /* closing anyway */ }
    try { writer.releaseLock(); reader.releaseLock(); } catch { /* noop */ }
    await socket.close().catch(() => {});
    return { ok: true };
  } catch (e: any) {
    try { await socket?.close(); } catch { /* noop */ }
    return { ok: false, error: String(e?.message ?? e).slice(0, 200) };
  }
}
