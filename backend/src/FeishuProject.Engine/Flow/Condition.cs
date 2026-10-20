namespace FeishuProject.Engine.Flow;

/// <summary>对工作项字段求值的条件，用于节点出现条件和卡点。</summary>
public abstract record Condition
{
    public abstract bool Evaluate(IReadOnlyDictionary<string, object?> fields);

    public static Condition Equal(string field, object value) => new EqualCondition(field, value);
    public static Condition NotEmpty(string field) => new NotEmptyCondition(field);
    public static Condition All(params Condition[] items) => new AllCondition(items);
    public static Condition Any(params Condition[] items) => new AnyCondition(items);

    internal static bool IsEmpty(object? value) => value switch
    {
        null => true,
        string s => string.IsNullOrWhiteSpace(s),
        System.Collections.ICollection c => c.Count == 0,
        _ => false,
    };
}

public sealed record EqualCondition(string Field, object Value) : Condition
{
    public override bool Evaluate(IReadOnlyDictionary<string, object?> fields) =>
        fields.TryGetValue(Field, out var actual)
        && actual is not null
        && string.Equals(Convert.ToString(actual), Convert.ToString(Value), StringComparison.Ordinal);
}

public sealed record NotEmptyCondition(string Field) : Condition
{
    public override bool Evaluate(IReadOnlyDictionary<string, object?> fields) =>
        fields.TryGetValue(Field, out var actual) && !IsEmpty(actual);
}

public sealed record AllCondition(IReadOnlyList<Condition> Items) : Condition
{
    public override bool Evaluate(IReadOnlyDictionary<string, object?> fields) =>
        Items.All(c => c.Evaluate(fields));
}

public sealed record AnyCondition(IReadOnlyList<Condition> Items) : Condition
{
    public override bool Evaluate(IReadOnlyDictionary<string, object?> fields) =>
        Items.Any(c => c.Evaluate(fields));
}
