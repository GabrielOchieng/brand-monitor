import { generateKeyPairSync, createVerify } from "node:crypto";
import { describe, it, expect } from "vitest";
import {
  buildMime,
  gmailAssertion,
  graphMessage,
  isPublicAddress,
  MailSendError,
  parseServiceAccountKey,
  publicConfigOf,
  sendOrgMail,
  SenderSecretsSchema,
} from "./orgMailer";

const identity = { fromAddress: "brandprotection@example.com", fromName: "Example Brand Protection", replyTo: "tickets@example.com", bccArchive: "archive@example.com" };
const message = {
  to: ["abuse@registrar.example"],
  cc: ["legal@example.com"],
  subject: "Phishing site impersonating Example",
  text: "Body",
  attachments: [{ filename: "shot.png", contentType: "image/png", content: Buffer.from("png") }],
};

describe("isPublicAddress", () => {
  it.each(["10.0.0.1", "127.0.0.1", "172.16.5.4", "172.31.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"])(
    "rejects %s",
    (ip) => expect(isPublicAddress(ip)).toBe(false)
  );
  it.each(["8.8.8.8", "172.32.0.1", "52.96.0.1", "2606:4700::1111"])("accepts %s", (ip) => expect(isPublicAddress(ip)).toBe(true));
  it("rejects non-addresses", () => expect(isPublicAddress("example.com")).toBe(false));
});

describe("sender config", () => {
  it("validates each provider", () => {
    expect(SenderSecretsSchema.safeParse({ provider: "graph", tenantId: "contoso.onmicrosoft.com", clientId: "11111111-2222-3333-4444-555555555555", clientSecret: "s" }).success).toBe(true);
    expect(SenderSecretsSchema.safeParse({ provider: "graph", tenantId: "x/../y", clientId: "11111111-2222-3333-4444-555555555555", clientSecret: "s" }).success).toBe(false);
    expect(SenderSecretsSchema.safeParse({ provider: "smtp", host: "smtp.example.com", port: 587, username: "u", password: "p" }).success).toBe(true);
    expect(SenderSecretsSchema.safeParse({ provider: "smtp", host: "smtp.example.com", port: 5432, username: "u", password: "p" }).success).toBe(false);
  });

  it("never exposes secrets in the public config", () => {
    const pub = publicConfigOf({ provider: "smtp", host: "smtp.example.com", port: 587, username: "u", password: "secret" });
    expect(JSON.stringify(pub)).not.toContain("secret");
    const g = publicConfigOf({ provider: "graph", tenantId: "t.onmicrosoft.com", clientId: "11111111-2222-3333-4444-555555555555", clientSecret: "secret" });
    expect(JSON.stringify(g)).not.toContain("secret");
  });

  it("reads a Google service account key", () => {
    expect(parseServiceAccountKey(JSON.stringify({ client_email: "sa@p.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\n..." }))?.client_email).toBe("sa@p.iam.gserviceaccount.com");
    expect(parseServiceAccountKey("{}")).toBeNull();
    expect(parseServiceAccountKey("not json")).toBeNull();
  });
});

describe("graphMessage", () => {
  it("adds the archive BCC, reply-to and attachments", () => {
    const g = graphMessage(identity, message);
    expect(g.saveToSentItems).toBe(true);
    expect(g.message.toRecipients).toEqual([{ emailAddress: { address: "abuse@registrar.example" } }]);
    expect(g.message.ccRecipients).toEqual([{ emailAddress: { address: "legal@example.com" } }]);
    expect(g.message.bccRecipients).toEqual([{ emailAddress: { address: "archive@example.com" } }]);
    expect(g.message.replyTo).toEqual([{ emailAddress: { address: "tickets@example.com" } }]);
    expect(g.message.body).toEqual({ contentType: "Text", content: "Body" });
    expect(g.message.attachments?.[0]).toMatchObject({ "@odata.type": "#microsoft.graph.fileAttachment", name: "shot.png", contentBytes: Buffer.from("png").toString("base64") });
  });
});

describe("Gmail", () => {
  it("signs a delegation assertion for the sender mailbox", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const key = { client_email: "sa@p.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
    const jwt = gmailAssertion(key, identity.fromAddress, 1_700_000_000);
    const [h, c, sig] = jwt.split(".");
    const claims = JSON.parse(Buffer.from(c, "base64url").toString());
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    expect(claims).toEqual({
      iss: key.client_email,
      sub: identity.fromAddress,
      scope: "https://www.googleapis.com/auth/gmail.send",
      aud: "https://oauth2.googleapis.com/token",
      iat: 1_700_000_000,
      exp: 1_700_003_600,
    });
    expect(createVerify("RSA-SHA256").update(`${h}.${c}`).verify(publicKey, Buffer.from(sig, "base64url"))).toBe(true);
  });

  it("keeps Bcc in the MIME message (the Gmail API delivers from the headers)", async () => {
    const mime = (await buildMime(identity, message)).toString();
    expect(mime).toMatch(/^From: Example Brand Protection <brandprotection@example\.com>/m);
    expect(mime).toMatch(/^Bcc: archive@example\.com/m);
    expect(mime).toMatch(/^Reply-To: tickets@example\.com/m);
    expect(mime).toContain('filename=shot.png');
  });
});

describe("sendOrgMail", () => {
  it("refuses an SMTP host on a private address", async () => {
    await expect(
      sendOrgMail({ provider: "smtp", host: "localhost", port: 587, username: "u", password: "p" }, identity, { to: ["a@example.com"], subject: "s", text: "t" })
    ).rejects.toThrow(MailSendError);
  });
  it("refuses an invalid recipient before connecting", async () => {
    await expect(
      sendOrgMail({ provider: "smtp", host: "smtp.example.com", port: 587, username: "u", password: "p" }, identity, { to: ["not-an-address"], subject: "s", text: "t" })
    ).rejects.toThrow("invalid recipient");
  });
});
