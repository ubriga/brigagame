// Minimal SMTP-over-TLS client (RFC 5321 subset) for Cloudflare Workers.
// Used for the inbox.lv provider: port 465, direct TLS, AUTH LOGIN.
import { connect } from "cloudflare:sockets";
function b64(s) {
    return btoa(unescape(encodeURIComponent(s)));
}
export async function sendSmtpMail(opts) {
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    let socket = null;
    try {
        socket = connect({ hostname: opts.host, port: opts.port }, { secureTransport: "on" });
        const writer = socket.writable.getWriter();
        const reader = socket.readable.getReader();
        let buf = "";
        const readReply = async () => {
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
                    new Promise((_, rej) => setTimeout(() => rej(new Error("smtp read timeout")), Math.max(1, deadline - Date.now()))),
                ]);
                if (read.done)
                    throw new Error("smtp connection closed: " + buf.slice(0, 120));
                buf += dec.decode(read.value, { stream: true });
            }
            throw new Error("smtp read timeout");
        };
        const send = async (line) => { await writer.write(enc.encode(line + "\r\n")); };
        const expect = async (want, what) => {
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
        await expect([250, 251], "RCPT TO");
        await send("DATA");
        await expect([354], "DATA");
        const nl = "\r\n";
        const body64 = b64(opts.text).replace(/.{1,76}/g, "$&" + nl);
        const msg = "From: Brigagame 2.0 <" + opts.from + ">" + nl +
            "To: <" + opts.to + ">" + nl +
            "Subject: =?UTF-8?B?" + b64(opts.subject) + "?=" + nl +
            "MIME-Version: 1.0" + nl +
            "Content-Type: text/plain; charset=UTF-8" + nl +
            "Content-Transfer-Encoding: base64" + nl + nl +
            body64 + nl + ".";
        await writer.write(enc.encode(msg + nl));
        await expect([250], "message body");
        await send("QUIT");
        try {
            await readReply();
        }
        catch { /* closing anyway */ }
        try {
            writer.releaseLock();
            reader.releaseLock();
        }
        catch { /* noop */ }
        await socket.close().catch(() => { });
        return { ok: true };
    }
    catch (e) {
        try {
            await socket?.close();
        }
        catch { /* noop */ }
        return { ok: false, error: String(e?.message ?? e).slice(0, 200) };
    }
}
//# sourceMappingURL=smtp.js.map