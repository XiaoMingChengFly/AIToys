import { describe, expect, it } from "vitest";
import { checkLayout, layoutFields, visibleLayoutFields } from "../src/index.ts";

const fields = ["a", "b", "c", "d"].map((key) => ({ key }));
const keys = (groups: ReturnType<typeof layoutFields<{ key: string }>>) =>
  groups.map((g) => [g.name, g.fields.map((f) => f.key).join(""), g.collapsed]);

describe("detail layout", () => {
  it("puts every field in one group without a layout", () => {
    expect(keys(layoutFields(fields, null))).toEqual([["字段", "abcd", false]]);
    expect(keys(layoutFields(fields, { groups: [], hidden: ["b"] }))).toEqual([["字段", "acd", false]]);
  });

  it("orders fields by group and collects the rest at the end", () => {
    const layout = {
      groups: [
        { name: "基本信息", fields: ["c", "a"] },
        { name: "空分组", fields: [] },
        { name: "财务", fields: ["gone", "c"], collapsed: true },
      ],
      hidden: ["d"],
    };
    expect(keys(layoutFields(fields, layout))).toEqual([
      ["基本信息", "ca", false],
      ["其他字段", "b", false],
    ]);
    expect(visibleLayoutFields(fields, layout).map((f) => f.key)).toEqual(["c", "a", "b"]);
    expect(keys(layoutFields(fields, { groups: [{ name: "财务", fields: ["b"], collapsed: true }] }))).toEqual([
      ["财务", "b", true],
      ["其他字段", "acd", false],
    ]);
  });

  it("rejects bad layouts", () => {
    const all = fields.map((f) => f.key);
    expect(checkLayout({ groups: [{ name: "x", fields: ["a"] }], hidden: ["b"] }, all)).toBeNull();
    expect(checkLayout({ groups: [{ name: " ", fields: [] }] }, all)).toMatch("不能为空");
    expect(
      checkLayout(
        {
          groups: [
            { name: "x", fields: [] },
            { name: "x ", fields: [] },
          ],
        },
        all,
      ),
    ).toMatch("重名");
    expect(checkLayout({ groups: [{ name: "x", fields: ["z"] }] }, all)).toMatch("不存在");
    expect(checkLayout({ groups: [{ name: "x", fields: ["a"] }], hidden: ["a"] }, all)).toMatch("不止一次");
  });
});
