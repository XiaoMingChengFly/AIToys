/**
 * 公式字段：一个小的表达式语言，用工作项自己的字段和子工作项的汇总算出一个值。
 *
 *   {工时} * {单价}
 *   IF({预算} > 10000, "大", "小")
 *   DAYS({截止日期}, {开始日期})
 *   SUBITEMS_SUM({工时}) / SUBITEMS_COUNT()
 *
 * 字段写成 {字段名}（也可以写字段键），保存时统一换成字段键。空值在加减乘除里按 0 算，
 * 在 & 拼接里按空字符串算；除以 0 得到空值。结果是数字、文本、日期（YYYY-MM-DD）或是否。
 */

export type FormulaValue = number | string | boolean | null;

export class FormulaError extends Error {
  override name = "FormulaError";
}

type Node =
  | { kind: "num"; value: number }
  | { kind: "str"; value: string }
  | { kind: "bool"; value: boolean }
  | { kind: "ref"; key: string }
  | { kind: "unary"; op: "-"; arg: Node }
  | { kind: "binary"; op: string; left: Node; right: Node }
  | { kind: "call"; name: string; args: Node[] };

/** 子工作项汇总：参数是子工作项上的字段（按字段键或名称对上）。 */
const AGGREGATES = ["SUBITEMS_SUM", "SUBITEMS_AVG", "SUBITEMS_MIN", "SUBITEMS_MAX"] as const;
/** 不带参数的子工作项计数。 */
const COUNTS = ["SUBITEMS_COUNT", "SUBITEMS_DONE"] as const;

/** 支持的函数和参数个数（[最少, 最多]），编辑器里也用它列出可用函数。 */
export const FORMULA_FUNCTIONS: Record<string, { args: [number, number]; doc: string }> = {
  IF: { args: [2, 3], doc: "IF(条件, 成立时, 不成立时)" },
  AND: { args: [1, 99], doc: "AND(条件1, 条件2, …) 都成立" },
  OR: { args: [1, 99], doc: "OR(条件1, 条件2, …) 有一个成立" },
  NOT: { args: [1, 1], doc: "NOT(条件)" },
  ISBLANK: { args: [1, 1], doc: "ISBLANK(值) 是否为空" },
  SUM: { args: [1, 99], doc: "SUM(数1, 数2, …)" },
  AVG: { args: [1, 99], doc: "AVG(数1, 数2, …)" },
  MIN: { args: [1, 99], doc: "MIN(数1, 数2, …)" },
  MAX: { args: [1, 99], doc: "MAX(数1, 数2, …)" },
  ROUND: { args: [1, 2], doc: "ROUND(数, 小数位)" },
  ABS: { args: [1, 1], doc: "ABS(数)" },
  CONCAT: { args: [1, 99], doc: "CONCAT(文本1, 文本2, …)" },
  LEN: { args: [1, 1], doc: "LEN(文本) 长度；多选、人员字段为个数" },
  DAYS: { args: [2, 2], doc: "DAYS(结束日期, 开始日期) 相差天数" },
  DATEADD: { args: [2, 2], doc: "DATEADD(日期, 天数)" },
  SUBITEMS_SUM: { args: [1, 1], doc: "SUBITEMS_SUM({字段}) 子工作项该字段之和" },
  SUBITEMS_AVG: { args: [1, 1], doc: "SUBITEMS_AVG({字段}) 子工作项该字段平均值" },
  SUBITEMS_MIN: { args: [1, 1], doc: "SUBITEMS_MIN({字段})" },
  SUBITEMS_MAX: { args: [1, 1], doc: "SUBITEMS_MAX({字段})" },
  SUBITEMS_COUNT: { args: [0, 0], doc: "SUBITEMS_COUNT() 子工作项个数" },
  SUBITEMS_DONE: { args: [0, 0], doc: "SUBITEMS_DONE() 已完成的子工作项个数" },
};

type Token =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "ref"; v: string }
  | { t: "id"; v: string }
  | { t: "op"; v: string };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source.charAt(i);
    if (/\s/.test(c)) {
      i++;
    } else if (/[0-9.]/.test(c)) {
      const m = /^[0-9]*\.?[0-9]+|^[0-9]+\.?/.exec(source.slice(i));
      if (!m) throw new FormulaError(`第 ${i + 1} 个字符附近的数字写错了。`);
      tokens.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
    } else if (c === '"') {
      const end = source.indexOf('"', i + 1);
      if (end < 0) throw new FormulaError("文本少了结尾的引号。");
      tokens.push({ t: "str", v: source.slice(i + 1, end) });
      i = end + 1;
    } else if (c === "{") {
      const end = source.indexOf("}", i + 1);
      if (end < 0) throw new FormulaError("字段少了结尾的 }。");
      tokens.push({ t: "ref", v: source.slice(i + 1, end).trim() });
      i = end + 1;
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i)) as RegExpExecArray;
      tokens.push({ t: "id", v: m[0].toUpperCase() });
      i += m[0].length;
    } else {
      const two = source.slice(i, i + 2);
      if ([">=", "<=", "!=", "<>"].includes(two)) {
        tokens.push({ t: "op", v: two === "<>" ? "!=" : two });
        i += 2;
      } else if ("+-*/&=<>(),".includes(c)) {
        tokens.push({ t: "op", v: c });
        i++;
      } else {
        throw new FormulaError(`不认识的字符「${c}」。`);
      }
    }
  }
  return tokens;
}

class Parser {
  private pos = 0;
  private readonly tokens: Token[];
  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse(): Node {
    if (this.tokens.length === 0) throw new FormulaError("公式是空的。");
    const node = this.comparison();
    if (this.pos < this.tokens.length) throw new FormulaError("公式末尾有多余的内容。");
    return node;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }
  private isOp(...ops: string[]): string | null {
    const t = this.peek();
    return t?.t === "op" && ops.includes(t.v) ? t.v : null;
  }
  private expect(op: string) {
    if (!this.isOp(op)) throw new FormulaError(`这里应该是「${op}」。`);
    this.pos++;
  }

  private comparison(): Node {
    const left = this.concat();
    const op = this.isOp("=", "!=", ">", ">=", "<", "<=");
    if (!op) return left;
    this.pos++;
    return { kind: "binary", op, left, right: this.concat() };
  }
  private concat(): Node {
    let node = this.additive();
    while (this.isOp("&")) {
      this.pos++;
      node = { kind: "binary", op: "&", left: node, right: this.additive() };
    }
    return node;
  }
  private additive(): Node {
    let node = this.term();
    for (let op = this.isOp("+", "-"); op; op = this.isOp("+", "-")) {
      this.pos++;
      node = { kind: "binary", op, left: node, right: this.term() };
    }
    return node;
  }
  private term(): Node {
    let node = this.unary();
    for (let op = this.isOp("*", "/"); op; op = this.isOp("*", "/")) {
      this.pos++;
      node = { kind: "binary", op, left: node, right: this.unary() };
    }
    return node;
  }
  private unary(): Node {
    if (this.isOp("-")) {
      this.pos++;
      return { kind: "unary", op: "-", arg: this.unary() };
    }
    return this.primary();
  }
  private primary(): Node {
    const t = this.peek();
    if (!t) throw new FormulaError("公式没写完。");
    this.pos++;
    switch (t.t) {
      case "num":
        return { kind: "num", value: t.v };
      case "str":
        return { kind: "str", value: t.v };
      case "ref":
        return { kind: "ref", key: t.v };
      case "id": {
        if (t.v === "TRUE" || t.v === "FALSE") return { kind: "bool", value: t.v === "TRUE" };
        const fn = FORMULA_FUNCTIONS[t.v];
        if (!fn) throw new FormulaError(`没有函数 ${t.v}。`);
        this.expect("(");
        const args: Node[] = [];
        if (!this.isOp(")")) {
          args.push(this.comparison());
          while (this.isOp(",")) {
            this.pos++;
            args.push(this.comparison());
          }
        }
        this.expect(")");
        if (args.length < fn.args[0] || args.length > fn.args[1])
          throw new FormulaError(`${t.v} 的参数个数不对：${fn.doc}。`);
        return { kind: "call", name: t.v, args };
      }
      case "op":
        if (t.v === "(") {
          const node = this.comparison();
          this.expect(")");
          return node;
        }
        throw new FormulaError(`这里不该出现「${t.v}」。`);
    }
  }
}

/** 公式求值时要读的数据。 */
export interface FormulaScope {
  /** 本工作项的字段值（按字段键）。 */
  field(key: string): unknown;
  /** 子工作项上某个字段的值（参数是公式里写的字段键或名称）；不提供时子工作项函数得到空值。 */
  subItemValues?(ref: string): unknown[];
  subItemCount?: number;
  subItemsDone?: number;
}

export interface CompiledFormula {
  /** 规范化后的源码：本工作项字段换成 {字段键}。 */
  source: string;
  /** 引用到的本工作项字段键。 */
  refs: string[];
  /** 是否用到子工作项汇总（要在服务端算）。 */
  usesSubItems: boolean;
  evaluate(scope: FormulaScope): FormulaValue;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const dayOf = (v: unknown): number | null =>
  typeof v === "string" && DATE.test(v) ? Math.round(Date.parse(`${v}T00:00:00Z`) / 86_400_000) : null;
const blank = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
const num = (v: unknown): number => {
  if (blank(v)) return 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const text = (v: unknown): string => {
  if (blank(v)) return "";
  if (Array.isArray(v)) return v.join("、");
  if (typeof v === "boolean") return v ? "是" : "否";
  return String(v);
};
const truthy = (v: unknown): boolean => !blank(v) && v !== false && v !== 0 && v !== "false";
const finite = (n: number): number | null => (Number.isFinite(n) ? n : null);

function compareValues(op: string, a: unknown, b: unknown): boolean {
  const da = dayOf(a);
  const db = dayOf(b);
  let x: number | string;
  let y: number | string;
  if (da !== null && db !== null) [x, y] = [da, db];
  else if (typeof a === "number" || typeof b === "number") [x, y] = [num(a), num(b)];
  else [x, y] = [text(a), text(b)];
  switch (op) {
    case "=":
      return x === y;
    case "!=":
      return x !== y;
    case ">":
      return x > y;
    case ">=":
      return x >= y;
    case "<":
      return x < y;
    default:
      return x <= y;
  }
}

function output(v: unknown): FormulaValue {
  if (blank(v)) return null;
  if (typeof v === "number") return finite(v);
  if (typeof v === "boolean" || typeof v === "string") return v;
  return text(v);
}

function evaluateNode(node: Node, scope: FormulaScope): unknown {
  switch (node.kind) {
    case "num":
    case "str":
    case "bool":
      return node.value;
    case "ref":
      return scope.field(node.key) ?? null;
    case "unary":
      return -num(evaluateNode(node.arg, scope));
    case "binary": {
      const a = evaluateNode(node.left, scope);
      const b = evaluateNode(node.right, scope);
      switch (node.op) {
        case "&":
          return text(a) + text(b);
        case "+":
          return num(a) + num(b);
        case "-":
          return num(a) - num(b);
        case "*":
          return num(a) * num(b);
        case "/":
          return num(b) === 0 ? null : num(a) / num(b);
        default:
          return compareValues(node.op, a, b);
      }
    }
    case "call":
      return call(node, scope);
  }
}

function call(node: Extract<Node, { kind: "call" }>, scope: FormulaScope): unknown {
  const arg = (i: number) => evaluateNode(node.args[i] as Node, scope);
  const all = () => node.args.map((a) => evaluateNode(a, scope));
  const nums = () => all().flatMap((v) => (blank(v) ? [] : [num(v)]));
  switch (node.name) {
    case "IF":
      return truthy(arg(0)) ? arg(1) : node.args.length > 2 ? arg(2) : null;
    case "AND":
      return all().every(truthy);
    case "OR":
      return all().some(truthy);
    case "NOT":
      return !truthy(arg(0));
    case "ISBLANK":
      return blank(arg(0));
    case "SUM":
      return nums().reduce((s, n) => s + n, 0);
    case "AVG": {
      const ns = nums();
      return ns.length ? ns.reduce((s, n) => s + n, 0) / ns.length : null;
    }
    case "MIN":
    case "MAX": {
      const ns = nums();
      if (!ns.length) return null;
      return node.name === "MIN" ? Math.min(...ns) : Math.max(...ns);
    }
    case "ROUND": {
      const digits = node.args.length > 1 ? Math.max(0, Math.min(10, Math.trunc(num(arg(1))))) : 0;
      const f = 10 ** digits;
      return Math.round(num(arg(0)) * f) / f;
    }
    case "ABS":
      return Math.abs(num(arg(0)));
    case "CONCAT":
      return all().map(text).join("");
    case "LEN": {
      const v = arg(0);
      return Array.isArray(v) ? v.length : text(v).length;
    }
    case "DAYS": {
      const end = dayOf(arg(0));
      const start = dayOf(arg(1));
      return end === null || start === null ? null : end - start;
    }
    case "DATEADD": {
      const day = dayOf(arg(0));
      if (day === null) return null;
      return new Date((day + Math.trunc(num(arg(1)))) * 86_400_000).toISOString().slice(0, 10);
    }
    case "SUBITEMS_COUNT":
      return scope.subItemCount ?? null;
    case "SUBITEMS_DONE":
      return scope.subItemsDone ?? null;
    default: {
      // 子工作项汇总：参数必须是一个字段
      const ref = node.args[0];
      if (!scope.subItemValues || ref?.kind !== "ref") return null;
      const ns = scope.subItemValues(ref.key).flatMap((v) => (blank(v) ? [] : [num(v)]));
      if (node.name === "SUBITEMS_SUM") return ns.reduce((s, n) => s + n, 0);
      if (!ns.length) return null;
      if (node.name === "SUBITEMS_AVG") return ns.reduce((s, n) => s + n, 0) / ns.length;
      return node.name === "SUBITEMS_MIN" ? Math.min(...ns) : Math.max(...ns);
    }
  }
}

const PRECEDENCE: Record<string, number> = { "&": 2, "+": 3, "-": 3, "*": 4, "/": 4 };
const precedence = (node: Node) =>
  node.kind === "binary" ? (PRECEDENCE[node.op] ?? 1) : node.kind === "unary" ? 5 : 6;

/** 把语法树写回源码（规范化后保存），只在需要时加括号。 */
function print(node: Node): string {
  switch (node.kind) {
    case "num":
      return String(node.value);
    case "str":
      return JSON.stringify(node.value);
    case "bool":
      return node.value ? "TRUE" : "FALSE";
    case "ref":
      return `{${node.key}}`;
    case "unary":
      return `-${wrap(node.arg, precedence(node.arg) < 5)}`;
    case "binary": {
      const p = precedence(node);
      return `${wrap(node.left, precedence(node.left) < p)} ${node.op} ${wrap(node.right, precedence(node.right) <= p)}`;
    }
    case "call":
      return `${node.name}(${node.args.map(print).join(", ")})`;
  }
}
const wrap = (node: Node, parens: boolean) => (parens ? `(${print(node)})` : print(node));

/**
 * 编译公式。resolve 把公式里写的字段名或字段键换成本工作项类型上的字段键，找不到返回 undefined。
 * 子工作项函数里的字段不在本类型上，原样保留，求值时再按子工作项的字段对。
 */
export function compileFormula(source: string, resolve: (ref: string) => string | undefined): CompiledFormula {
  const tree = new Parser(tokenize(source)).parse();
  const refs = new Set<string>();
  let usesSubItems = false;
  const walk = (node: Node, inAggregate: boolean): Node => {
    switch (node.kind) {
      case "ref": {
        if (inAggregate) return node;
        const key = resolve(node.key);
        if (!key) throw new FormulaError(`字段「${node.key}」不存在。`);
        refs.add(key);
        return { kind: "ref", key };
      }
      case "unary":
        return { ...node, arg: walk(node.arg, inAggregate) };
      case "binary":
        return { ...node, left: walk(node.left, inAggregate), right: walk(node.right, inAggregate) };
      case "call": {
        const aggregate = (AGGREGATES as readonly string[]).includes(node.name);
        if (aggregate || (COUNTS as readonly string[]).includes(node.name)) usesSubItems = true;
        if (aggregate && node.args[0]?.kind !== "ref")
          throw new FormulaError(`${node.name} 的参数要写成一个字段，比如 ${node.name}({工时})。`);
        return { ...node, args: node.args.map((a) => walk(a, aggregate)) };
      }
      default:
        return node;
    }
  };
  const resolved = walk(tree, false);
  return {
    source: print(resolved),
    refs: [...refs],
    usesSubItems,
    evaluate: (scope) => output(evaluateNode(resolved, scope)),
  };
}

/**
 * 按依赖顺序排列一个类型上的公式字段：被引用的先算。有循环引用时抛错，指出是哪些字段。
 */
export function orderFormulas<T extends { key: string; name: string; refs: readonly string[] }>(formulas: T[]): T[] {
  const byKey = new Map(formulas.map((f) => [f.key, f]));
  const done = new Set<string>();
  const visiting = new Set<string>();
  const ordered: T[] = [];
  const visit = (f: T, path: string[]) => {
    if (done.has(f.key)) return;
    if (visiting.has(f.key)) throw new FormulaError(`公式循环引用：${[...path, f.name].join(" → ")}。`);
    visiting.add(f.key);
    for (const ref of f.refs) {
      const dep = byKey.get(ref);
      if (dep) visit(dep, [...path, f.name]);
    }
    visiting.delete(f.key);
    done.add(f.key);
    ordered.push(f);
  };
  for (const f of formulas) visit(f, []);
  return ordered;
}
