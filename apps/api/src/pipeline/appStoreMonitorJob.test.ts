import { describe, it, expect } from "vitest";
import { impersonatingApps, type StoreApp } from "./appStoreMonitorJob";
import { isOfficialListing, parseAppListingUrl } from "../lib/appListings";
import { canonicalOfficialUrl } from "../routes/brands";

const play = (appId: string, title: string, publisher: string): StoreApp => ({
  store: "google_play",
  appId,
  title,
  publisher,
  url: `https://play.google.com/store/apps/details?id=${appId}`,
});

// Google Play's Kenya store, search "jambojet" / "jambo jet", 2026-11-20 (excerpt).
const liveResults = [
  play("com.jambojet.booking.twa", "FlyJambojet", "Jambojet Limited"),
  play("net.skyscanner.android.main", "Skyscanner Flights Hotels Cars", "Skyscanner Ltd"),
  play("com.kenyaairways.prodapp", "Kenya Airways", "Kenya Airways PLC"),
  play("net.kairosoft.android.airport", "Jumbo Airport Story", "Kairosoft"),
  play("io.appery.project488623", "Jettly: Private Jet Charter", "Jettly"),
  play("com.jetesim.app", "Jet eSIM: Travel eSIM & Data", "JET eSIM"),
  play("uk.jetlog.app", "JetLog: Plane Spotting Logbook", "Jetlog"),
  play("com.mttnow.droid.easyjet", "easyJet: Travel App", "easyJet Airline Company Limited"),
];

describe("impersonatingApps", () => {
  it("flags only the brand-named app when no official apps are listed", () => {
    expect(impersonatingApps(liveResults, "jambojet", []).map((a) => a.appId)).toEqual(["com.jambojet.booking.twa"]);
  });

  it("skips the brand's official app, from a store link with extra parameters", () => {
    const official = ["https://play.google.com/store/apps/details?id=com.jambojet.booking.twa&hl=en_US"];
    expect(impersonatingApps(liveResults, "jambojet", official)).toEqual([]);
  });

  it("flags lookalike names and publishers", () => {
    const fakes = [
      play("com.jambo.jet.booking", "Jambo Jet Booking", "Travel Deals KE"),
      play("com.cheap.flights.ke", "Cheap Flights Kenya", "Jamb0jet Tickets"),
    ];
    expect(impersonatingApps(fakes, "jambojet", ["https://play.google.com/store/apps/details?id=com.jambojet.booking.twa"])).toHaveLength(2);
  });

  it("keeps the stores apart: an official iOS id doesn't excuse a Play app", () => {
    const ios: StoreApp = { store: "app_store", appId: "123456789", title: "FlyJambojet", publisher: "Jambojet Limited", url: "https://apps.apple.com/ke/app/flyjambojet/id123456789" };
    expect(impersonatingApps([ios], "jambojet", ["https://apps.apple.com/us/app/flyjambojet/id123456789?uo=4"])).toEqual([]);
    expect(impersonatingApps([play("123456789", "FlyJambojet", "x")], "jambojet", ["https://apps.apple.com/app/id123456789"])).toHaveLength(1);
  });
});

describe("app links", () => {
  it("parses store links into canonical identities", () => {
    expect(parseAppListingUrl("play.google.com/store/apps/details?id=com.jambojet.booking.twa&hl=en")).toEqual({
      store: "google_play",
      appId: "com.jambojet.booking.twa",
      url: "https://play.google.com/store/apps/details?id=com.jambojet.booking.twa",
    });
    expect(parseAppListingUrl("https://apps.apple.com/ke/app/flyjambojet/id1234567890?uo=4")?.url).toBe("https://apps.apple.com/app/id1234567890");
    expect(parseAppListingUrl("https://play.google.com/store/apps/developer?id=Jambojet+Limited")).toBeNull();
    expect(parseAppListingUrl("https://www.jambojet.com/")).toBeNull();
  });

  it("is accepted in the official accounts list", () => {
    expect(canonicalOfficialUrl("https://play.google.com/store/apps/details?id=com.jambojet.booking.twa&hl=en")).toBe(
      "https://play.google.com/store/apps/details?id=com.jambojet.booking.twa"
    );
    expect(canonicalOfficialUrl("https://example.com/app")).toBeNull();
  });

  it("lets a recheck see that an existing app finding is now official", () => {
    expect(isOfficialListing(["https://apps.apple.com/app/id1234567890"], "https://apps.apple.com/us/app/flyjambojet/id1234567890?uo=4")).toBe(true);
    expect(isOfficialListing([], "https://play.google.com/store/apps/details?id=com.jambojet.booking.twa")).toBe(false);
  });
});
