namespace FeishuProject.Engine.Flow;

public enum NodeState
{
    NotStarted,
    InProgress,
    Completed,

    /// <summary>出现条件不满足，被流程裁剪掉。汇聚时视为已通过。</summary>
    Skipped,
}

public enum WorkItemStatus
{
    InProgress,
    Completed,
}

public sealed class NodeRuntime
{
    public NodeState State { get; set; } = NodeState.NotStarted;
    public List<string> Owners { get; } = [];
    public HashSet<string> Confirmations { get; } = [];
}

/// <summary>一个工作项在流程上的运行状态。由 <see cref="FlowEngine"/> 修改。</summary>
public sealed class WorkItemState
{
    public WorkItemStatus Status { get; set; } = WorkItemStatus.InProgress;
    public string? Stage { get; set; }
    public Dictionary<string, NodeRuntime> Nodes { get; } = [];

    public NodeState this[string nodeKey] => Nodes[nodeKey].State;
}

public abstract record FlowEvent(string? NodeKey);
public sealed record NodeStarted(string Key) : FlowEvent(Key);
public sealed record NodeCompleted(string Key, string? By) : FlowEvent(Key);
public sealed record NodeSkipped(string Key) : FlowEvent(Key);
public sealed record NodeRestored(string Key) : FlowEvent(Key);
public sealed record NodeConfirmed(string Key, string By) : FlowEvent(Key);
public sealed record NodeRolledBack(string Key, string By) : FlowEvent(Key);
public sealed record StageChanged(string? From, string To, string Key) : FlowEvent(Key);
public sealed record WorkItemCompleted() : FlowEvent((string?)null);
public sealed record WorkItemReopened() : FlowEvent((string?)null);
