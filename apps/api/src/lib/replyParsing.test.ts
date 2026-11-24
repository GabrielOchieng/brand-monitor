import { describe, it, expect } from "vitest";
import { bouncedRecipients, isBounce, isOutOfOffice, reportRefsIn, ticketRefIn } from "./replyParsing";

describe("reportRefsIn", () => {
  it("finds our tag in a reply subject, case-insensitively and once", () => {
    expect(reportRefsIn("RE: [BM-7KQ2X9TD] Fraud: example[.]com")).toEqual(["BM-7KQ2X9TD"]);
    expect(reportRefsIn("re: [bm-7kq2x9td] and again BM-7KQ2X9TD")).toEqual(["BM-7KQ2X9TD"]);
  });
  it("ignores look-alikes outside the alphabet or length", () => {
    expect(reportRefsIn("BM-0OI1L000 BM-ABC")).toEqual([]);
  });
});

describe("isBounce", () => {
  it("recognises delivery failures", () => {
    expect(isBounce({ from: "MAILER-DAEMON@mx.example", subject: "Returned mail" })).toBe(true);
    expect(isBounce({ from: "postmaster@outlook.com", subject: "x" })).toBe(true);
    expect(isBounce({ from: "noreply@x.example", subject: "Undeliverable: [BM-7KQ2X9TD] Fraud" })).toBe(true);
    expect(isBounce({ from: "abuse@registrar.example", subject: "RE: [BM-7KQ2X9TD] Fraud" })).toBe(false);
  });
});

describe("isOutOfOffice", () => {
  it("skips out-of-office notes but not ticket acknowledgements", () => {
    expect(isOutOfOffice({ subject: "Automatic reply: [BM-7KQ2X9TD] Fraud" })).toBe(true);
    expect(isOutOfOffice({ subject: "Automatic reply: Abuse ticket 123456 created" })).toBe(false);
  });
});

describe("ticketRefIn", () => {
  it("pulls out the recipient's ticket number", () => {
    expect(ticketRefIn("RE: [BM-7KQ2X9TD] Fraud [Ticket#2026112810000123]", "")).toBe("2026112810000123");
    expect(ticketRefIn("Your abuse report", "Thank you. Case number: ABU-48213. We will investigate.")).toBe("ABU-48213");
    expect(ticketRefIn("Re: report [#INC-55821]", "")).toBe("INC-55821");
  });
  it("never returns our own tag or a word", () => {
    expect(ticketRefIn("Ticket received for BM-7KQ2X9TD", "Reference BM-7KQ2X9TD")).toBeNull();
  });
});

describe("bouncedRecipients", () => {
  it("names the addresses the bounce mentions, or the only recipient", () => {
    expect(bouncedRecipients("550 5.1.1 <abuse@gone.example>: user unknown", ["abuse@gone.example", "legal@x.example"])).toEqual(["abuse@gone.example"]);
    expect(bouncedRecipients("delivery failed", ["only@x.example"])).toEqual(["only@x.example"]);
    expect(bouncedRecipients("delivery failed", ["a@x.example", "b@x.example"])).toEqual([]);
  });
});
