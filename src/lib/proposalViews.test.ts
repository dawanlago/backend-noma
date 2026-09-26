import { describe, expect, it } from "vitest";
import { clampDuration, MAX_SESSION_SECONDS, parseBody, summarizeUserAgent } from "./proposalViews";

describe("visualizações de proposta", () => {
  it("resume o user agent em dispositivo, sistema e navegador", () => {
    expect(
      summarizeUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      ),
    ).toEqual({ device: "mobile", os: "iOS", browser: "Safari" });
    expect(
      summarizeUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0",
      ),
    ).toEqual({ device: "desktop", os: "Windows", browser: "Edge" });
    expect(
      summarizeUserAgent("Mozilla/5.0 (Linux; Android 14; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"),
    ).toEqual({ device: "tablet", os: "Android", browser: "Chrome" });
    expect(
      summarizeUserAgent(
        "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36 Instagram 300.0",
      ).browser,
    ).toBe("Instagram");
    expect(summarizeUserAgent(undefined)).toEqual({ device: "unknown", os: "", browser: "" });
  });

  it("limita o tempo ao decorrido desde a abertura e ao teto da sessão", () => {
    const opened = new Date("2026-01-01T10:00:00Z");
    expect(clampDuration(30, opened, new Date("2026-01-01T10:01:00Z"))).toBe(30);
    expect(clampDuration(9999, opened, new Date("2026-01-01T10:01:00Z"))).toBe(70);
    expect(clampDuration(1e9, opened, new Date("2026-01-03T10:00:00Z"))).toBe(MAX_SESSION_SECONDS);
    expect(clampDuration(-5, opened)).toBeNull();
    expect(clampDuration("abc", opened)).toBeNull();
  });

  it("aceita o corpo em JSON ou texto (sendBeacon)", () => {
    expect(parseBody({ seconds: 3 })).toEqual({ seconds: 3 });
    expect(parseBody('{"seconds":3}')).toEqual({ seconds: 3 });
    expect(parseBody("lixo")).toEqual({});
    expect(parseBody("[1]")).toEqual({});
  });
});
