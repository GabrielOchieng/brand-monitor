import { describe, it, expect } from "vitest";
import { classifyWebResult, siteNameResemblesBrand, webQueries } from "./webSearchFindings";
import { asksRecruitmentFee } from "../lib/recruitmentScam";

const brand = {
  brandRoot: "jambojet",
  ownKeys: new Set(["whatsapp:+254740555333", "phone:+254740555333"]),
  ownDomains: ["jambojet.com"],
};

describe("web searches", () => {
  it("runs customer care and recruitment daily and alternates the booking pitch", () => {
    const day = new Date("2026-11-20T06:20:00Z");
    const next = new Date("2026-11-21T06:20:00Z");
    const today = webQueries("Jambojet", day).map((q) => q.query);
    const tomorrow = webQueries("Jambojet", next).map((q) => q.query);
    expect(today).toHaveLength(3);
    expect(today[0]).toBe('"Jambojet customer care number"');
    expect(today[1]).toContain("recruitment");
    expect(today[2]).not.toBe(tomorrow[2]);
  });
});

describe("classifyWebResult with the 2026-11-20 live results", () => {
  it("ignores legitimate travel, job and news pages that name the brand", () => {
    const legit = [
      { url: "https://www.kayak.co.uk/flight-routes/Nairobi-Jomo-Kenyatta-Intl-NBO/Lamu-LAU", title: "£52 CHEAP FLIGHTS from Nairobi Airport to Lamu (NBO - LAU)", content: "Fly from Jomo Kenyatta Airport, Nairobi to Lamu on Jambojet from £52... Search for Lamu flights on KAYAK now to find the best deal." },
      { url: "https://www.flyingcarpet.travel/airline-partner/jambojet", title: "Jambojet - FlyingCarpet.Travel", content: "Explore affordable flights, hotels, vacations to fit all budgets, Jambojet is a Kenyan low-cost carrier, Book your flight and get your ticket on FlyingCarpet." },
      { url: "https://www.careerjet.co.ke/flight-operations-jobs", title: "flight operations Jobs, Vacancies in Kenya - Nairobi - Careerjet", content: "Captain at Jambojet. Nairobi. Join Our Flight Deck Crew as a Captain Are you an accomplished pilot holding an ATPL, with comprehensive CRM training and" },
      { url: "https://www.myjobmag.co.ke/jobs/vacancies-at-jambojet-8", title: "Vacancies at Jambojet - 12 November, 2026 - MyJobMag", content: "Job Opportunities at Jambojet with 2 positions in Nairobi, Kenya. Candidates with 5,000+ total flight hours, including 1,500+ hours on type," },
      { url: "https://capitalfm.africa/jambojet-turns-to-flight-data-single-engine-taxiing-to-cut-fuel-consumption", title: "Jambojet turns to flight data, single-engine taxiing to cut fuel consumption – Capital FM", content: "“With all these insights gathered, we monitor and track each and every flight" },
      { url: "https://tavily.com/knowledge/company/IhHPZ1piuM7X", title: "Jambojet", content: "# Jambojet ID: IhHPZ1piuM7X Website: www.jambojet.com Headquarters: Nairobi, Nairobi, Kenya" },
    ];
    for (const r of legit) expect(classifyWebResult(r, brand), r.url).toBeNull();
  });

  it("leaves social posts to the social rules", () => {
    const tiktok = { url: "https://www.tiktok.com/@jambojet72/video/7704206696687750421", title: "#jambojet#0738566688 | TikTok", content: "- Contact Jambojet Customer Care or Bookings for any clarifications." };
    expect(classifyWebResult(tiktok, brand)).toBeNull();
  });

  it("skips the brand's own sites", () => {
    expect(classifyWebResult({ url: "https://book.jambojet.com/contact", title: "Jambojet contact", content: "Call 0711 024 550" }, brand)).toBeNull();
  });
});

describe("classifyWebResult on scam patterns", () => {
  it("flags a page giving a foreign customer-care number next to the brand", () => {
    const hit = classifyWebResult(
      { url: "https://kenya-airline-help.blogspot.com/2026/11/jambojet.html", title: "Jambojet Customer Care Number", content: "Call Jambojet customer care on 0738 566 688 for refunds and bookings." },
      brand
    );
    expect(hit).toMatchObject({ type: "url", reasons: ["contact_details"], indicators: [{ kind: "phone", value: "+254738566688" }] });
  });

  it("doesn't treat the brand's own number as foreign", () => {
    expect(classifyWebResult({ url: "https://travelke.co.ke/jambojet", title: "Jambojet", content: "Jambojet WhatsApp: +254 740 555 333" }, brand)).toBeNull();
  });

  it("flags lookalike sites, including on free hosting", () => {
    expect(classifyWebResult({ url: "https://flyjambojetkenya.store/", title: "Fly JamboJet", content: "Book Jambojet flights" }, brand)).toMatchObject({
      identifier: "flyjambojetkenya.store",
      type: "domain",
      reasons: ["site_name"],
    });
    expect(siteNameResemblesBrand("https://jambojet-booking.vercel.app/book", "jambojet")).toBe(true);
    expect(siteNameResemblesBrand("https://sites.google.com/view/jambojet-refunds", "jambojet")).toBe(true);
    expect(siteNameResemblesBrand("https://sites.google.com/view/travel-tips", "jambojet")).toBe(false);
    expect(siteNameResemblesBrand("https://www.flyingcarpet.travel/airline-partner/jambojet", "jambojet")).toBe(false);
  });

  it("flags a recruitment page that asks for a fee", () => {
    const hit = classifyWebResult(
      { url: "https://aviationjobs-ke.com/jambojet-cabin-crew", title: "Jambojet Cabin Crew Recruitment 2026", content: "Jambojet is recruiting cabin crew. Pay a registration fee of KES 2,500 to secure your interview slot." },
      brand
    );
    expect(hit?.reasons).toEqual(["recruitment_fee"]);
  });
});

describe("asksRecruitmentFee", () => {
  it("fires on hiring plus a fee, in English or Swahili", () => {
    expect(asksRecruitmentFee("Jambojet cabin crew vacancies. Application fee Ksh 1,000 via M-Pesa.", "jambojet")).toBe(true);
    expect(asksRecruitmentFee("Nafasi za kazi Jambojet! Lipa ada ya usajili 500 kupitia M-Pesa.", "jambojet")).toBe(true);
    expect(asksRecruitmentFee("Jambojet flight attendants needed. Send KES 3500 for medical clearance.", "jambojet")).toBe(true);
  });

  it("doesn't fire on real job reposts or fare offers (2026-11-20 live results)", () => {
    expect(asksRecruitmentFee("Jambojet is currently hiring Flight Attendants and Flight Pursers in Nairobi, Kenya. To apply for the Flight Attendant role, you must have a Cabin Crew Certificate.", "jambojet")).toBe(false);
    expect(asksRecruitmentFee("250+ JOB OPPORTUNITIES AVAILABLE Positions may include: ✓ Pilots and Flight Crew ✓ Cabin Crew and Flight Attendants", "jambojet")).toBe(false);
    expect(asksRecruitmentFee("Fly More, Pay Less with Jambojet! Explore Kenya and beyond with fares from KSh 8,500.", "jambojet")).toBe(false);
    expect(asksRecruitmentFee("Cabin crew training fee KES 150,000 at Sky Academy.", "jambojet")).toBe(false);
  });
});
