import { beforeEach, describe, expect, it, vi } from "vitest";

const search = vi.fn();
vi.mock("@/application/container", () => ({ createGeocoder: () => ({ search }) }));

const get = async (qs: string) => {
  const { GET } = await import("./route");
  return GET(new Request(`http://localhost/api/places?${qs}`));
};

describe("GET /api/places", () => {
  beforeEach(() => {
    search.mockReset();
  });

  it("busca el texto, con el sesgo si viene, y deja guardar la respuesta unos minutos", async () => {
    search.mockResolvedValue([{ label: "Vélez, Santander", lat: 6.01, lon: -73.67 }]);
    const res = await get("q=%20v%C3%A9lez%20&lat=7.1&lon=-73.1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ label: "Vélez, Santander", lat: 6.01, lon: -73.67 }]);
    expect(search).toHaveBeenCalledWith("vélez", { lat: 7.1, lon: -73.1 });
    expect(res.headers.get("cache-control")).toContain("max-age=300");
  });

  it("no llama a los proveedores con menos de 2 letras, y corta textos largos", async () => {
    expect(await (await get("q=a")).json()).toEqual([]);
    expect(search).not.toHaveBeenCalled();
    search.mockResolvedValue([]);
    await get(`q=${"x".repeat(500)}`);
    expect(search.mock.calls[0]![0]).toHaveLength(120);
  });

  it("ignora coordenadas inválidas", async () => {
    search.mockResolvedValue([]);
    await get("q=bogota&lat=abc&lon=-74");
    await get("q=bogota&lat=95&lon=-74");
    expect(search.mock.calls.map((c) => c[1])).toEqual([undefined, undefined]);
  });

  it("si Mapbox falla responde 502 (la UI ofrece reintentar)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    search.mockImplementation(async () => {
      throw new Error("HTTP 503 https://api.mapbox.com/…");
    });
    const res = await get("q=bogota");
    expect(res.status).toBe(502);
  });
});
