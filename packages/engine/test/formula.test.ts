import { describe, expect, it } from "vitest";
import { compileFormula, FormulaError, fieldIndex, formatFieldValue, orderFormulas } from "../src/index.ts";

const FIELDS: Record<string, string> = { 工时: "hours", 单价: "price", 开始: "start", 结束: "end", 标签: "tags" };
const resolve = (ref: string) => FIELDS[ref] ?? (Object.values(FIELDS).includes(ref) ? ref : undefined);
const values: Record<string, unknown> = {
  hours: 8,
  price: 12.5,
  start: "2026-11-02",
  end: "2026-11-09",
  tags: ["a", "b"],
};
const run = (source: string, extra: Record<string, unknown> = {}) =>
  compileFormula(source, resolve).evaluate({ field: (k) => ({ ...values, ...extra })[k] ?? null });

describe("formula", () => {
  it("does arithmetic with precedence and treats blanks as 0", () => {
    expect(run("{工时} * {单价} + 1")).toBe(101);
    expect(run("({工时} + 2) * 2")).toBe(20);
    expect(run("-{工时} / 4")).toBe(-2);
    expect(run("{工时} + {单价}", { price: null })).toBe(8);
    expect(run("{工时} / 0")).toBeNull();
  });

  it("supports conditions, text and dates", () => {
    expect(run('IF({工时} > 5, "长", "短")')).toBe("长");
    expect(run('IF(AND({工时} >= 8, NOT(ISBLANK({单价}))), "ok")')).toBe("ok");
    expect(run('"共 " & {工时} & " 小时"')).toBe("共 8 小时");
    expect(run("DAYS({结束}, {开始})")).toBe(7);
    expect(run("DATEADD({开始}, 30)")).toBe("2026-12-02");
    expect(run("{结束} > {开始}")).toBe(true);
    expect(run("LEN({标签})")).toBe(2);
    expect(run("ROUND(10 / 3, 2)")).toBe(3.33);
    expect(run("MAX({工时}, {单价}, 3)")).toBe(12.5);
  });

  it("rewrites field names to keys and reports what it references", () => {
    const f = compileFormula("{工时}*({单价} + 1)", resolve);
    expect(f.source).toBe("{hours} * ({price} + 1)");
    expect(f.refs).toEqual(["hours", "price"]);
    expect(f.usesSubItems).toBe(false);
    expect(compileFormula(f.source, resolve).source).toBe(f.source);
  });

  it("aggregates sub-items", () => {
    const f = compileFormula("SUBITEMS_SUM({工时}) / SUBITEMS_COUNT()", resolve);
    expect(f.usesSubItems).toBe(true);
    // 子工作项函数里的字段按子工作项的字段对，不要求本类型上有
    expect(compileFormula("SUBITEMS_MAX({估分})", resolve).source).toBe("SUBITEMS_MAX({估分})");
    const scope = {
      field: () => null,
      subItemValues: (ref: string) => (ref === "工时" ? [3, null, 5] : []),
      subItemCount: 4,
      subItemsDone: 1,
    };
    expect(f.evaluate(scope)).toBe(2);
    expect(compileFormula("SUBITEMS_DONE() / SUBITEMS_COUNT()", resolve).evaluate(scope)).toBe(0.25);
  });

  it("explains mistakes", () => {
    expect(() => compileFormula("{不存在} + 1", resolve)).toThrow("字段「不存在」不存在");
    expect(() => compileFormula("FOO(1)", resolve)).toThrow("没有函数 FOO");
    expect(() => compileFormula("IF(1)", resolve)).toThrow("参数个数不对");
    expect(() => compileFormula("(1 + 2", resolve)).toThrow(FormulaError);
    expect(() => compileFormula("SUBITEMS_SUM(1)", resolve)).toThrow("要写成一个字段");
  });

  it("orders formulas by dependency and rejects cycles", () => {
    const a = { key: "a", name: "A", refs: ["b"] };
    const b = { key: "b", name: "B", refs: ["hours"] };
    expect(orderFormulas([a, b]).map((f) => f.key)).toEqual(["b", "a"]);
    expect(() => orderFormulas([a, { ...b, refs: ["a"] }])).toThrow("循环引用");
  });

  it("indexes and formats results by their value type", () => {
    const spec = { name: "x", dataType: "formula" as const };
    expect(fieldIndex(spec, 3.5).num).toBe(3.5);
    expect(fieldIndex(spec, "2026-01-02").str).toBe("2026-01-02");
    expect(fieldIndex(spec, true).items).toEqual(["true"]);
    expect(formatFieldValue(spec, 0.1 + 0.2)).toBe("0.3");
  });
});
