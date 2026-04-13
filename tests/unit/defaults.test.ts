import { describe, it, expect } from "vitest";
import { DEFAULT_SERVICES, DEFAULT_WORKING_HOURS, DEFAULT_PARALLEL_PAIRS } from "../../netlify/lib/defaults";
import { ServicesSchema, WorkingHoursSchema, ParallelPairsSchema } from "../../netlify/lib/schemas";

describe("defaults", () => {
  it("DEFAULT_SERVICES parses against schema", () => {
    expect(ServicesSchema.safeParse(DEFAULT_SERVICES).success).toBe(true);
  });

  it("DEFAULT_SERVICES includes expected ids", () => {
    const ids = DEFAULT_SERVICES.map((s) => s.id);
    expect(ids).toContain("manikir-klasican");
    expect(ids).toContain("manikir-gel");
    expect(ids).toContain("body-sculpt");
  });

  it("DEFAULT_WORKING_HOURS parses", () => {
    expect(WorkingHoursSchema.safeParse(DEFAULT_WORKING_HOURS).success).toBe(true);
  });

  it("DEFAULT_WORKING_HOURS closes Sunday", () => {
    expect(DEFAULT_WORKING_HOURS.sunday.open).toBe(false);
  });

  it("DEFAULT_PARALLEL_PAIRS parses", () => {
    expect(ParallelPairsSchema.safeParse(DEFAULT_PARALLEL_PAIRS).success).toBe(true);
  });
});
