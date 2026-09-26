import { describe, expect, it } from "vitest";
import {
  assertNoSecrets,
  recordingFetch,
  redactUrl,
  replayFetch,
  UnrecordedRequestError,
  type CassetteInteraction,
} from "./cassette";

const TOKEN = "pk.test-token-1234567890";

function fakeFetch(body: unknown, status = 200): typeof fetch {
  return async () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("redactUrl", () => {
  it("reemplaza los parámetros secretos y conserva el resto", () => {
    const out = redactUrl(`https://api.mapbox.com/directions/v5/x?alternatives=true&access_token=${TOKEN}`);
    expect(out).toContain("alternatives=true");
    expect(out).toContain("access_token=***");
    expect(out).not.toContain(TOKEN);
  });

  it("deja igual una URL sin secretos o inválida", () => {
    expect(redactUrl("https://api.open-meteo.com/v1/elevation?latitude=7")).toBe(
      "https://api.open-meteo.com/v1/elevation?latitude=7",
    );
    expect(redactUrl("no es una url")).toBe("no es una url");
  });
});

describe("recordingFetch", () => {
  it("graba la respuesta sin el token y la sigue entregando", async () => {
    const sink: CassetteInteraction[] = [];
    const f = recordingFetch(fakeFetch({ ok: 1 }), sink);
    const res = await f(`https://api.mapbox.com/r?access_token=${TOKEN}`);
    expect(await res.json()).toEqual({ ok: 1 });
    expect(sink).toHaveLength(1);
    expect(sink[0]).toMatchObject({
      method: "GET",
      url: "https://api.mapbox.com/r?access_token=***",
      status: 200,
      contentType: "application/json",
      body: '{"ok":1}',
    });
  });

  it("acepta URL y Request además de string", async () => {
    const sink: CassetteInteraction[] = [];
    const f = recordingFetch(fakeFetch({}), sink);
    await f(new URL("https://a.test/x"));
    await f(new Request("https://a.test/y", { method: "POST" }));
    expect(sink.map((s) => `${s.method} ${s.url}`)).toEqual(["GET https://a.test/x", "POST https://a.test/y"]);
  });
});

describe("replayFetch", () => {
  const interactions: CassetteInteraction[] = [
    { method: "GET", url: "https://api.mapbox.com/r?access_token=***", status: 200, contentType: "application/json", body: '{"routes":[]}' },
    { method: "GET", url: "https://api.open-meteo.com/e", status: 429, contentType: null, body: "slow down" },
  ];

  it("responde lo grabado aunque el token de la petición sea otro", async () => {
    const f = replayFetch(interactions);
    const res = await f("https://api.mapbox.com/r?access_token=otro-token");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ routes: [] });
  });

  it("repite la misma respuesta y conserva el estado HTTP", async () => {
    const f = replayFetch(interactions);
    expect((await f("https://api.open-meteo.com/e")).status).toBe(429);
    expect(await (await f("https://api.open-meteo.com/e")).text()).toBe("slow down");
  });

  it("falla ante una petición no grabada", async () => {
    const f = replayFetch(interactions);
    await expect(f("https://api.mapbox.com/otra")).rejects.toBeInstanceOf(UnrecordedRequestError);
    await expect(f("https://api.open-meteo.com/e", { method: "POST" })).rejects.toThrow(/fuera de la grabación/);
  });
});

describe("assertNoSecrets", () => {
  it("acepta una grabación limpia", () => {
    expect(() => assertNoSecrets('{"url":"x?access_token=***"}', [TOKEN, undefined, ""])).not.toThrow();
  });

  it("rechaza un secreto del entorno", () => {
    expect(() => assertNoSecrets(`{"body":"${TOKEN}"}`, [TOKEN])).toThrow(/secreto/);
  });

  it("rechaza un access_token sin redactar", () => {
    expect(() => assertNoSecrets('{"url":"x?access_token=abc"}', [])).toThrow(/access_token/);
  });
});
