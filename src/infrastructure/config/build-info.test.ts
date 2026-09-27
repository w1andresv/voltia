import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("buildInfo", () => {
  it("en Vercel usa el commit, la rama y el entorno del despliegue", async () => {
    const { buildInfo } = await import("./build-info");
    expect(
      buildInfo({
        VERCEL: "1",
        VERCEL_GIT_COMMIT_SHA: "4bfc22f0123456789",
        VERCEL_GIT_COMMIT_REF: "engine-v2",
        VERCEL_ENV: "preview",
      } as unknown as NodeJS.ProcessEnv),
    ).toEqual({ commit: "4bfc22f", branch: "engine-v2", environment: "preview" });
  });

  it("fuera de Vercel dice que es local (el commit sale de git, si hay)", async () => {
    const { buildInfo } = await import("./build-info");
    const info = buildInfo({} as NodeJS.ProcessEnv);
    expect(info.environment).toBe("local");
    expect(info.commit.length).toBeGreaterThan(0);
  });
});
