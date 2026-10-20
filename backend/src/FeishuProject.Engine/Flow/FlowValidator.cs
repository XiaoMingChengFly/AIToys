namespace FeishuProject.Engine.Flow;

/// <summary>流程模板发布前的校验。错误阻止发布，警告只提示（飞书里允许的写法照样允许）。</summary>
public static class FlowValidator
{
    public static ValidationResult Validate(FlowDefinition definition)
    {
        var errors = new List<string>();
        var warnings = new List<string>();

        foreach (var dup in definition.Nodes.GroupBy(n => n.Key).Where(g => g.Count() > 1))
            errors.Add($"节点键重复：{dup.Key}");
        if (errors.Count > 0) return new(errors, warnings);

        foreach (var edge in definition.Edges)
        {
            if (!definition.HasNode(edge.From)) errors.Add($"连线起点不存在：{edge.From}");
            if (!definition.HasNode(edge.To)) errors.Add($"连线终点不存在：{edge.To}");
        }
        if (errors.Count > 0) return new(errors, warnings);

        var starts = definition.Nodes.Where(n => definition.Predecessors(n.Key).Count == 0).ToList();
        if (starts.Count != 1)
            errors.Add($"流程必须有且只有一个起始节点，现在有 {starts.Count} 个。");

        if (HasCycle(definition))
            errors.Add("流程图里存在环。");

        foreach (var node in definition.Nodes)
        {
            if (node.Completion is CompletionMode.SingleConfirm or CompletionMode.AllConfirm && node.OwnerRoles.Count == 0)
                warnings.Add($"节点「{node.Name}」需要人确认，但没有配置负责角色。");
        }

        if (errors.Count == 0 && starts.Count == 1)
            warnings.AddRange(StageRegressions(definition, starts[0].Key));

        return new(errors, warnings);
    }

    private static bool HasCycle(FlowDefinition definition)
    {
        var inDegree = definition.Nodes.ToDictionary(n => n.Key, n => definition.Predecessors(n.Key).Count);
        var queue = new Queue<string>(inDegree.Where(p => p.Value == 0).Select(p => p.Key));
        var visited = 0;
        while (queue.Count > 0)
        {
            var key = queue.Dequeue();
            visited++;
            foreach (var next in definition.Successors(key))
                if (--inDegree[next] == 0) queue.Enqueue(next);
        }
        return visited != definition.Nodes.Count;
    }

    /// <summary>
    /// 节点把阶段改回比某个前序节点更早的阶段时给出警告（如 OEM 的“配方成本初步核算”）。
    /// 阶段先后按它们在流程里第一次出现的顺序推断。
    /// </summary>
    private static IEnumerable<string> StageRegressions(FlowDefinition definition, string start)
    {
        var order = new List<string>();
        var stageRank = new Dictionary<string, int>();
        foreach (var key in TopologicalOrder(definition, start))
        {
            var stage = definition.Node(key).StageOnArrival;
            if (stage is not null && !stageRank.ContainsKey(stage)) stageRank[stage] = stageRank.Count;
            order.Add(key);
        }

        var maxBefore = new Dictionary<string, int>();
        foreach (var key in order)
        {
            var inherited = definition.Predecessors(key)
                .Select(p => maxBefore.GetValueOrDefault(p, -1)).DefaultIfEmpty(-1).Max();
            var node = definition.Node(key);
            var own = node.StageOnArrival is { } s ? stageRank[s] : -1;
            if (own >= 0 && own < inherited)
                yield return $"节点「{node.Name}」会把阶段改回「{node.StageOnArrival}」，早于它前面已经到达的阶段。";
            maxBefore[key] = Math.Max(own, inherited);
        }
    }

    private static List<string> TopologicalOrder(FlowDefinition definition, string start)
    {
        var inDegree = definition.Nodes.ToDictionary(n => n.Key, n => definition.Predecessors(n.Key).Count);
        var queue = new Queue<string>([start]);
        var result = new List<string>();
        while (queue.Count > 0)
        {
            var key = queue.Dequeue();
            result.Add(key);
            foreach (var next in definition.Successors(key))
                if (--inDegree[next] == 0) queue.Enqueue(next);
        }
        return result;
    }
}

public sealed record ValidationResult(IReadOnlyList<string> Errors, IReadOnlyList<string> Warnings)
{
    public bool IsValid => Errors.Count == 0;
}
