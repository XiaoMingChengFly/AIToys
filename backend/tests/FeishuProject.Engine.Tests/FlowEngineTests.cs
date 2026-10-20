using FeishuProject.Engine.Flow;
using static FeishuProject.Engine.Flow.CompletionMode;

namespace FeishuProject.Engine.Tests;

public class FlowEngineTests
{
    private static readonly Dictionary<string, object?> NoFields = [];

    private static FlowDefinition Flow(params (string Key, string[] Preds, CompletionMode Mode, Condition? Visible)[] nodes) =>
        new("t", 1,
            nodes.Select(n => new NodeDefinition(n.Key, n.Key, n.Mode, ["owner"], n.Visible)).ToList(),
            nodes.SelectMany(n => n.Preds.Select(p => new EdgeDefinition(p, n.Key))).ToList());

    private static IReadOnlyDictionary<string, IReadOnlyList<string>> Owners(FlowDefinition f) =>
        f.Nodes.ToDictionary(n => n.Key, _ => (IReadOnlyList<string>)["u1"]);

    [Fact]
    public void Start_node_begins_in_progress()
    {
        var flow = Flow(("a", [], SingleConfirm, null), ("b", ["a"], SingleConfirm, null));
        var (state, events) = new FlowEngine(flow).Start(NoFields, Owners(flow));

        Assert.Equal(NodeState.InProgress, state["a"]);
        Assert.Equal(NodeState.NotStarted, state["b"]);
        Assert.Contains(new NodeStarted("a"), events);
    }

    [Fact]
    public void Join_waits_for_all_predecessors()
    {
        var flow = Flow(("a", [], SingleConfirm, null), ("b", ["a"], SingleConfirm, null),
            ("c", ["a"], SingleConfirm, null), ("d", ["b", "c"], SingleConfirm, null));
        var engine = new FlowEngine(flow);
        var (state, _) = engine.Start(NoFields, Owners(flow));
        var u1 = new Actor("u1");

        engine.Confirm(state, "a", u1, NoFields);
        Assert.Equal(NodeState.InProgress, state["b"]);
        Assert.Equal(NodeState.InProgress, state["c"]);

        engine.Confirm(state, "b", u1, NoFields);
        Assert.Equal(NodeState.NotStarted, state["d"]);

        engine.Confirm(state, "c", u1, NoFields);
        Assert.Equal(NodeState.InProgress, state["d"]);
    }

    [Fact]
    public void Skipped_node_in_a_chain_does_not_let_successor_start_early()
    {
        var hidden = Condition.Equal("x", "是");
        var flow = Flow(("a", [], SingleConfirm, null), ("b", ["a"], SingleConfirm, hidden), ("c", ["b"], SingleConfirm, null));
        var engine = new FlowEngine(flow);
        var (state, _) = engine.Start(NoFields, Owners(flow));

        Assert.Equal(NodeState.Skipped, state["b"]);
        Assert.Equal(NodeState.NotStarted, state["c"]);

        engine.Confirm(state, "a", new Actor("u1"), NoFields);
        Assert.Equal(NodeState.InProgress, state["c"]);
    }

    [Fact]
    public void Node_reappears_when_its_condition_becomes_true()
    {
        var flow = Flow(("a", [], SingleConfirm, null), ("b", ["a"], SingleConfirm, Condition.Equal("x", "是")));
        var engine = new FlowEngine(flow);
        var (state, _) = engine.Start(NoFields, Owners(flow));
        engine.Confirm(state, "a", new Actor("u1"), NoFields);
        Assert.Equal(NodeState.Skipped, state["b"]);

        engine.OnFieldsChanged(state, new Dictionary<string, object?> { ["x"] = "是" });
        Assert.Equal(NodeState.InProgress, state["b"]);
    }

    [Fact]
    public void All_confirm_needs_every_owner()
    {
        var flow = Flow(("a", [], AllConfirm, null), ("b", ["a"], SingleConfirm, null));
        var engine = new FlowEngine(flow);
        var owners = new Dictionary<string, IReadOnlyList<string>> { ["a"] = ["u1", "u2"], ["b"] = ["u1"] };
        var (state, _) = engine.Start(NoFields, owners);

        engine.Confirm(state, "a", new Actor("u1"), NoFields);
        Assert.Equal(NodeState.InProgress, state["a"]);

        engine.Confirm(state, "a", new Actor("u2"), NoFields);
        Assert.Equal(NodeState.Completed, state["a"]);
    }

    [Fact]
    public void Non_owner_cannot_confirm()
    {
        var flow = Flow(("a", [], SingleConfirm, null));
        var engine = new FlowEngine(flow);
        var (state, _) = engine.Start(NoFields, Owners(flow));

        Assert.Throws<FlowException>(() => engine.Confirm(state, "a", new Actor("someone-else"), NoFields));
    }

    [Fact]
    public void Rollback_resets_downstream_nodes_and_reopens_work_item()
    {
        var flow = Flow(("a", [], SingleConfirm, null), ("b", ["a"], SingleConfirm, null));
        var engine = new FlowEngine(flow);
        var (state, _) = engine.Start(NoFields, Owners(flow));
        var u1 = new Actor("u1");
        engine.Confirm(state, "a", u1, NoFields);
        engine.Confirm(state, "b", u1, NoFields);
        Assert.Equal(WorkItemStatus.Completed, state.Status);

        engine.Rollback(state, "a", u1, NoFields);

        Assert.Equal(NodeState.InProgress, state["a"]);
        Assert.Equal(NodeState.NotStarted, state["b"]);
        Assert.Equal(WorkItemStatus.InProgress, state.Status);
    }

    [Fact]
    public void Validator_rejects_cycles_and_missing_nodes()
    {
        var cyclic = new FlowDefinition("t", 1,
            [new("a", "a"), new("b", "b"), new("c", "c")],
            [new("a", "b"), new("b", "c"), new("c", "b")]);
        Assert.Contains(FlowValidator.Validate(cyclic).Errors, e => e.Contains("环"));

        var dangling = new FlowDefinition("t", 1, [new("a", "a")], [new("a", "zzz")]);
        Assert.False(FlowValidator.Validate(dangling).IsValid);
    }
}
