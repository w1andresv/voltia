import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/infrastructure/db", () => ({ getSql: async () => ({ query }) }));

import { ensureUser } from "./user-store";

const SUBJECT = "11111111-1111-4111-8111-111111111111";
const identity = { provider: "supabase", subject: SUBJECT, email: "a@b.co" };

beforeEach(() => query.mockReset());

describe("ensureUser", () => {
  it("identidad ya registrada: devuelve su usuario sin crear nada", async () => {
    query.mockResolvedValueOnce([{ user_id: "internal-1" }]).mockResolvedValueOnce([]);
    expect(await ensureUser(identity)).toBe("internal-1");
    const sqls = query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /insert into public\.voltia_users/i.test(s))).toBe(false);
    expect(sqls.some((s) => /insert into public\.voltia_user_identities/i.test(s))).toBe(false);
  });

  it("primer login: crea el usuario (con id = auth.uid() para Supabase) y registra la identidad", async () => {
    query
      .mockResolvedValueOnce([]) // no hay identidad
      .mockResolvedValueOnce([{ id: SUBJECT }]) // insert users
      .mockResolvedValueOnce([]) // insert identities
      .mockResolvedValueOnce([{ user_id: SUBJECT }]); // relectura
    expect(await ensureUser(identity)).toBe(SUBJECT);
    const insertUser = query.mock.calls[1]!;
    expect(String(insertUser[0])).toMatch(/insert into public\.voltia_users/i);
    expect(insertUser[1]).toEqual(["a@b.co", SUBJECT]);
    expect(query.mock.calls[2]![1]).toEqual(["supabase", SUBJECT, SUBJECT]);
  });

  it("otro proveedor: el usuario recibe un uuid propio (preferredId null)", async () => {
    query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "generated" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ user_id: "generated" }]);
    expect(await ensureUser({ provider: "google", subject: "abc", email: "a@b.co" })).toBe(
      "generated",
    );
    expect(query.mock.calls[1]![1]).toEqual(["a@b.co", null]);
  });

  it("carrera: gana la identidad que quedó registrada", async () => {
    query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "mine" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ user_id: "winner" }]);
    expect(await ensureUser(identity)).toBe("winner");
  });

  it("segundo login idéntico no crea filas (idempotente)", async () => {
    query.mockResolvedValue([{ user_id: "internal-1" }]);
    await ensureUser(identity);
    await ensureUser(identity);
    const inserts = query.mock.calls.filter((c) => /insert into/i.test(String(c[0])));
    expect(inserts).toHaveLength(0);
  });
});
