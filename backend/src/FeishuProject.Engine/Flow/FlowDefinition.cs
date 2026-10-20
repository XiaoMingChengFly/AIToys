namespace FeishuProject.Engine.Flow;

/// <summary>
/// 一个流程模板版本的完整定义（节点 + 连线）。发布后不可修改，改动只能发布新版本。
/// </summary>
public sealed record FlowDefinition(
    string Key,
    int Version,
    IReadOnlyList<NodeDefinition> Nodes,
    IReadOnlyList<EdgeDefinition> Edges)
{
    private Dictionary<string, NodeDefinition>? _byKey;
    private Dictionary<string, List<string>>? _predecessors;
    private Dictionary<string, List<string>>? _successors;

    public NodeDefinition Node(string key) =>
        (_byKey ??= Nodes.ToDictionary(n => n.Key))[key];

    public bool HasNode(string key) =>
        (_byKey ??= Nodes.ToDictionary(n => n.Key)).ContainsKey(key);

    public IReadOnlyList<string> Predecessors(string key)
    {
        _predecessors ??= BuildIndex(e => e.To, e => e.From);
        return _predecessors.TryGetValue(key, out var list) ? list : [];
    }

    public IReadOnlyList<string> Successors(string key)
    {
        _successors ??= BuildIndex(e => e.From, e => e.To);
        return _successors.TryGetValue(key, out var list) ? list : [];
    }

    /// <summary>没有后续节点的节点。工作项完成的判定看这些节点。</summary>
    public IEnumerable<NodeDefinition> LeafNodes => Nodes.Where(n => Successors(n.Key).Count == 0);

    private Dictionary<string, List<string>> BuildIndex(
        Func<EdgeDefinition, string> key, Func<EdgeDefinition, string> value)
    {
        var index = new Dictionary<string, List<string>>();
        foreach (var edge in Edges)
        {
            if (!index.TryGetValue(key(edge), out var list))
                index[key(edge)] = list = [];
            list.Add(value(edge));
        }
        return index;
    }
}

public sealed record EdgeDefinition(string From, string To);

public sealed record NodeDefinition(
    string Key,
    string Name,
    CompletionMode Completion = CompletionMode.SingleConfirm,
    IReadOnlyList<string>? OwnerRoles = null,
    Condition? Visibility = null,
    Condition? Gate = null,
    string? StageOnArrival = null)
{
    public IReadOnlyList<string> OwnerRoles { get; init; } = OwnerRoles ?? [];
}

public enum CompletionMode
{
    /// <summary>任一负责人确认即完成。</summary>
    SingleConfirm,

    /// <summary>会签：全部负责人确认才完成。</summary>
    AllConfirm,

    /// <summary>卡点条件满足后自动完成；只有超管可以手动完成。</summary>
    Auto,

    /// <summary>关联的子工作项走到结束时完成。</summary>
    SubItemDriven,
}
