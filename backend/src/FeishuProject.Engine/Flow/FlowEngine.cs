namespace FeishuProject.Engine.Flow;

/// <summary>
/// 节点流引擎。所有状态变化都在这里计算：输入一个操作，修改 <see cref="WorkItemState"/>，
/// 返回发生的事件。不依赖数据库，便于单元测试和事件回放。
/// </summary>
public sealed class FlowEngine(FlowDefinition definition)
{
    /// <summary>一次操作引发的连锁重算最多跑这么多轮，防止配置错误导致死循环。</summary>
    public const int MaxPasses = 1000;

    public FlowDefinition Definition { get; } = definition;

    /// <summary>新建工作项：初始化所有节点并推进到第一个需要人处理的位置。</summary>
    public (WorkItemState State, IReadOnlyList<FlowEvent> Events) Start(
        IReadOnlyDictionary<string, object?> fields,
        IReadOnlyDictionary<string, IReadOnlyList<string>>? owners = null)
    {
        var state = new WorkItemState();
        foreach (var node in Definition.Nodes)
        {
            var runtime = new NodeRuntime();
            if (owners?.TryGetValue(node.Key, out var list) == true)
                runtime.Owners.AddRange(list);
            state.Nodes[node.Key] = runtime;
        }

        var events = new List<FlowEvent>();
        Recompute(state, fields, events);
        return (state, events);
    }

    /// <summary>字段变化后调用：重新求值出现条件和自动节点的卡点。</summary>
    public IReadOnlyList<FlowEvent> OnFieldsChanged(WorkItemState state, IReadOnlyDictionary<string, object?> fields)
    {
        var events = new List<FlowEvent>();
        Recompute(state, fields, events);
        return events;
    }

    /// <summary>负责人确认节点（单人确认、会签），或超管手动完成自动节点。</summary>
    public IReadOnlyList<FlowEvent> Confirm(
        WorkItemState state, string nodeKey, Actor actor, IReadOnlyDictionary<string, object?> fields)
    {
        var node = Definition.Node(nodeKey);
        var runtime = state.Nodes[nodeKey];

        if (runtime.State != NodeState.InProgress)
            throw new FlowException($"节点「{node.Name}」当前不是进行中，不能确认。");

        var isOwner = runtime.Owners.Contains(actor.UserId);
        switch (node.Completion)
        {
            case CompletionMode.Auto or CompletionMode.SubItemDriven when !actor.IsSuperAdmin:
                throw new FlowException($"节点「{node.Name}」是自动节点，只有超管可以手动完成。");
            case CompletionMode.SingleConfirm or CompletionMode.AllConfirm when !isOwner && !actor.IsSuperAdmin:
                throw new FlowException($"你不是节点「{node.Name}」的负责人。");
        }

        if (node.Gate is not null && !node.Gate.Evaluate(fields) && !IsManualOverride(node, actor))
            throw new FlowException($"节点「{node.Name}」的流转条件还没满足。");

        var events = new List<FlowEvent>();
        if (node.Completion == CompletionMode.AllConfirm && !actor.IsSuperAdmin)
        {
            runtime.Confirmations.Add(actor.UserId);
            events.Add(new NodeConfirmed(nodeKey, actor.UserId));
            if (!runtime.Owners.All(runtime.Confirmations.Contains))
                return events;
        }

        Complete(state, nodeKey, actor.UserId, events);
        Recompute(state, fields, events);
        return events;
    }

    /// <summary>关联的子工作项走到结束时调用，完成“子工作项驱动”的节点。</summary>
    public IReadOnlyList<FlowEvent> CompleteBySubItem(
        WorkItemState state, string nodeKey, IReadOnlyDictionary<string, object?> fields)
    {
        var events = new List<FlowEvent>();
        if (state.Nodes[nodeKey].State != NodeState.InProgress)
            return events; // 节点还没到达或已被裁剪：忽略，与飞书自动化“条件不满足不执行”一致
        Complete(state, nodeKey, by: null, events);
        Recompute(state, fields, events);
        return events;
    }

    /// <summary>回滚：把节点重置为进行中，它之后已经开始或完成的节点全部打回未开始。</summary>
    public IReadOnlyList<FlowEvent> Rollback(
        WorkItemState state, string nodeKey, Actor actor, IReadOnlyDictionary<string, object?> fields)
    {
        var runtime = state.Nodes[nodeKey];
        if (runtime.State is not (NodeState.InProgress or NodeState.Completed))
            throw new FlowException($"节点「{Definition.Node(nodeKey).Name}」还没到达，不能回滚。");

        var events = new List<FlowEvent> { new NodeRolledBack(nodeKey, actor.UserId) };
        runtime.State = NodeState.InProgress;
        runtime.Confirmations.Clear();

        foreach (var key in Descendants(nodeKey))
        {
            var downstream = state.Nodes[key];
            if (downstream.State is NodeState.InProgress or NodeState.Completed)
            {
                downstream.State = NodeState.NotStarted;
                downstream.Confirmations.Clear();
            }
        }

        if (state.Status == WorkItemStatus.Completed)
        {
            state.Status = WorkItemStatus.InProgress;
            events.Add(new WorkItemReopened());
        }

        Recompute(state, fields, events);
        return events;
    }

    private static bool IsManualOverride(NodeDefinition node, Actor actor) =>
        actor.IsSuperAdmin && node.Completion is CompletionMode.Auto or CompletionMode.SubItemDriven;

    private void Complete(WorkItemState state, string nodeKey, string? by, List<FlowEvent> events)
    {
        state.Nodes[nodeKey].State = NodeState.Completed;
        events.Add(new NodeCompleted(nodeKey, by));
    }

    /// <summary>反复应用规则直到状态不再变化：可见性 → 开始 → 自动完成 → 工作项完成。</summary>
    private void Recompute(WorkItemState state, IReadOnlyDictionary<string, object?> fields, List<FlowEvent> events)
    {
        for (var pass = 0; pass < MaxPasses; pass++)
        {
            var changed = ApplyVisibility(state, fields, events)
                          | ApplyStarts(state, events)
                          | ApplyAutoCompletions(state, fields, events);
            if (!changed)
            {
                ApplyWorkItemCompletion(state, events);
                return;
            }
        }
        throw new FlowException("流程重算超过上限，可能存在循环依赖。");
    }

    private bool ApplyVisibility(WorkItemState state, IReadOnlyDictionary<string, object?> fields, List<FlowEvent> events)
    {
        var changed = false;
        foreach (var node in Definition.Nodes)
        {
            if (node.Visibility is null) continue;
            var runtime = state.Nodes[node.Key];
            var visible = node.Visibility.Evaluate(fields);

            if (!visible && runtime.State is NodeState.NotStarted or NodeState.InProgress)
            {
                runtime.State = NodeState.Skipped;
                runtime.Confirmations.Clear();
                events.Add(new NodeSkipped(node.Key));
                changed = true;
            }
            else if (visible && runtime.State == NodeState.Skipped)
            {
                runtime.State = NodeState.NotStarted;
                events.Add(new NodeRestored(node.Key));
                changed = true;
            }
        }
        return changed;
    }

    private bool ApplyStarts(WorkItemState state, List<FlowEvent> events)
    {
        var changed = false;
        var passed = new Dictionary<string, bool>();
        foreach (var node in Definition.Nodes)
        {
            var runtime = state.Nodes[node.Key];
            if (runtime.State != NodeState.NotStarted) continue;
            if (!Definition.Predecessors(node.Key).All(p => IsPassed(state, p, passed))) continue;

            runtime.State = NodeState.InProgress;
            events.Add(new NodeStarted(node.Key));
            if (node.StageOnArrival is { } stage && stage != state.Stage)
            {
                events.Add(new StageChanged(state.Stage, stage, node.Key));
                state.Stage = stage;
            }
            changed = true;
        }
        return changed;
    }

    /// <summary>
    /// 节点对后续节点而言是否“已通过”：已完成；或被裁剪且它自己的前序都已通过。
    /// 后者保证 A → B(裁剪) → C 时，C 仍要等 A。
    /// </summary>
    private bool IsPassed(WorkItemState state, string key, Dictionary<string, bool> memo)
    {
        if (memo.TryGetValue(key, out var cached)) return cached;
        var result = state.Nodes[key].State switch
        {
            NodeState.Completed => true,
            NodeState.Skipped => Definition.Predecessors(key).All(p => IsPassed(state, p, memo)),
            _ => false,
        };
        memo[key] = result;
        return result;
    }

    private bool ApplyAutoCompletions(WorkItemState state, IReadOnlyDictionary<string, object?> fields, List<FlowEvent> events)
    {
        var changed = false;
        foreach (var node in Definition.Nodes)
        {
            if (node.Completion != CompletionMode.Auto) continue;
            if (state.Nodes[node.Key].State != NodeState.InProgress) continue;
            if (node.Gate is not null && !node.Gate.Evaluate(fields)) continue;
            Complete(state, node.Key, by: null, events);
            changed = true;
        }
        return changed;
    }

    /// <summary>所有可见的末端节点都完成时，工作项完成。被裁剪的末端节点不参与判断。</summary>
    private void ApplyWorkItemCompletion(WorkItemState state, List<FlowEvent> events)
    {
        if (state.Status == WorkItemStatus.Completed) return;
        var leaves = Definition.LeafNodes.Select(n => state.Nodes[n.Key].State).ToList();
        if (leaves.All(s => s is NodeState.Completed or NodeState.Skipped)
            && leaves.Any(s => s == NodeState.Completed))
        {
            state.Status = WorkItemStatus.Completed;
            events.Add(new WorkItemCompleted());
        }
    }

    private IEnumerable<string> Descendants(string key)
    {
        var seen = new HashSet<string>();
        var queue = new Queue<string>(Definition.Successors(key));
        while (queue.Count > 0)
        {
            var next = queue.Dequeue();
            if (!seen.Add(next)) continue;
            foreach (var s in Definition.Successors(next)) queue.Enqueue(s);
        }
        return seen;
    }
}

public sealed record Actor(string UserId, bool IsSuperAdmin = false);

public sealed class FlowException(string message) : Exception(message);
