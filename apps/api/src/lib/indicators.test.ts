import { describe, it, expect } from "vitest";
import { extractIndicators, withoutOwnIndicators, serializeIndicators, deserializeIndicatorKeys } from "./indicators";

const values = (text: string, links: string[] = []) => extractIndicators(text, links).map((i) => `${i.kind}:${i.value}`).sort();

describe("extractIndicators", () => {
  it("normalizes Kenyan numbers in every common written form to E.164", () => {
    expect(values("Call 0712 345 678 or 0712-345-678")).toEqual(["phone:+254712345678"]);
    expect(values("Customer care: +254 712 345678")).toEqual(["phone:+254712345678"]);
    expect(values("Reach us on 254 110 123 456")).toEqual(["phone:+254110123456"]);
  });

  it("keeps foreign numbers only when written with a plus", () => {
    expect(values("UK office +44 20 7946 0958")).toEqual(["phone:+442079460958"]);
  });

  it("ignores digit runs that aren't phone numbers", () => {
    expect(values("Flight JM 8012, KES 12,500, booking 4528193047, 2026-10-19, ref 0034567890")).toEqual([]);
  });

  it("reads WhatsApp and tel links", () => {
    expect(values("", ["https://wa.me/254712345678?text=hi", "https://api.whatsapp.com/send?phone=254700111222", "tel:0712%20345%20678"])).toEqual([
      "phone:+254712345678",
      "whatsapp:+254700111222",
      "whatsapp:+254712345678",
    ]);
    expect(values("Chat with us on wa.me/254712345678")).toEqual(["whatsapp:+254712345678"]);
  });

  it("keeps foreign local-format tel: numbers as bare digits, never +0...", () => {
    // Real links from jamboojet.com (Tehran office numbers).
    expect(values("", ["tel:02191035700", "tel:021284280"])).toEqual(["phone:021284280", "phone:02191035700"]);
    expect(values("Call +0 21 9103 5700")).toEqual([]);
  });

  it("reads M-Pesa paybill and till numbers", () => {
    expect(values("Lipa na M-Pesa: Paybill No. 247247, Account: your name")).toEqual(["mpesa_paybill:247247"]);
    expect(values("PAY BILL: 400200")).toEqual(["mpesa_paybill:400200"]);
    expect(values("Buy Goods Till Number 5123456")).toEqual(["mpesa_till:5123456"]);
  });

  it("reads emails but skips placeholders and image filenames", () => {
    expect(values("Write to refunds.jambojet@gmail.com. or you@example.com, logo@2x.png, noreply@x.co")).toEqual([
      "email:refunds.jambojet@gmail.com",
    ]);
    expect(values("", ["mailto:Support@Fake-Air.com?subject=hi"])).toEqual(["email:support@fake-air.com"]);
  });

  it("reads Telegram handles, not share links", () => {
    expect(values("Join https://t.me/JambojetPromo or t.me/share/url?x=1", ["https://telegram.me/+AbCdEf123"])).toEqual([
      "telegram:+abcdef123",
      "telegram:jambojetpromo",
    ]);
  });

  it("reads crypto wallets", () => {
    expect(values("Send USDT to 0x52908400098527886E0F7030069857D2E4169EE7")).toEqual([
      "crypto_wallet:0x52908400098527886e0f7030069857d2e4169ee7",
    ]);
    expect(values("BTC: bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq")).toEqual(["crypto_wallet:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq"]);
    expect(values("TRC20: TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7")).toEqual(["crypto_wallet:TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7"]);
  });

  it("doesn't take ordinary long words for base58 wallets", () => {
    expect(values("Thisisanordinarylongwordwithoutdigits and 1111111111111111111111111111")).toEqual([]);
  });
});

describe("withoutOwnIndicators", () => {
  it("drops the brand's own contacts and emails at its own domains", () => {
    const found = extractIndicators("Call +254 711 024 545, email care@jambojet.com or help@mail.jambojet.com, or 0722 000 111");
    const own = deserializeIndicatorKeys(serializeIndicators(extractIndicators("Call centre +254711024545")));
    expect(withoutOwnIndicators(found, own, ["jambojet.com"]).map((i) => i.value)).toEqual(["+254722000111"]);
  });
});
