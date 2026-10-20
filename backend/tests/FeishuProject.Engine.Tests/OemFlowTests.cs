using FeishuProject.Engine.Flow;
using FeishuProject.Engine.Tests.Fixtures;

namespace FeishuProject.Engine.Tests;

/// <summary>设计文档里「OEM 验收用例清单」中只涉及流程引擎的那几条。</summary>
public class OemFlowTests
{
    private readonly FlowEngine _engine = new(OemFlow.Definition);
    private readonly Dictionary<string, object?> _fields = new()
    {
        [OemFlow.NeedPhaseOut] = "是",
        [OemFlow.NeedLaunchPlan] = "是",
        [OemFlow.NeedConceptTest] = "否",
        [OemFlow.NeedVideo] = "是",
        [OemFlow.NeedFiling] = "是",
        [OemFlow.LinkedSku] = "SKU-001",
    };

    private static readonly Actor Admin = new("admin", IsSuperAdmin: true);

    private WorkItemState Start() => _engine.Start(_fields, OemFlow.OwnersByRole()).State;

    /// <summary>把当前所有进行中的指定节点按它们自己的完成方式推过去。</summary>
    private void Pass(WorkItemState state, params string[] keys)
    {
        foreach (var key in keys)
        {
            var node = OemFlow.Definition.Node(key);
            Assert.True(state[key] == NodeState.InProgress, $"{node.Name} 应为进行中，实际 {state[key]}");
            switch (node.Completion)
            {
                case CompletionMode.SubItemDriven:
                    _engine.CompleteBySubItem(state, key, _fields);
                    break;
                case CompletionMode.AllConfirm:
                    foreach (var owner in state.Nodes[key].Owners)
                        _engine.Confirm(state, key, new Actor(owner), _fields);
                    break;
                default:
                    _engine.Confirm(state, key, new Actor(state.Nodes[key].Owners[0]), _fields);
                    break;
            }
        }
    }

    [Fact]
    public void Imports_48_nodes_and_52_edges_and_passes_validation()
    {
        Assert.Equal(48, OemFlow.Definition.Nodes.Count);
        Assert.Equal(52, OemFlow.Definition.Edges.Count);
        Assert.Equal(17, OemFlow.Definition.LeafNodes.Count());

        var result = FlowValidator.Validate(OemFlow.Definition);
        Assert.True(result.IsValid, string.Join("；", result.Errors));
    }

    [Fact]
    public void Validator_flags_the_stage_regression_on_initial_cost_check()
    {
        var warnings = FlowValidator.Validate(OemFlow.Definition).Warnings;
        Assert.Contains(warnings, w => w.Contains("配方成本初步核算"));
    }

    [Fact]
    public void New_project_auto_completes_start_and_waits_on_proposal()
    {
        var state = Start();

        Assert.Equal(NodeState.Completed, state["start"]);
        Assert.Equal(NodeState.InProgress, state["doing"]);
        Assert.Equal("概念阶段", state.Stage);
    }

    [Fact]
    public void Proposal_needs_all_three_signers_and_a_linked_sku()
    {
        var state = Start();

        _engine.Confirm(state, "doing", new Actor("NPD"), _fields);
        _engine.Confirm(state, "doing", new Actor("财务BP负责人"), _fields);
        Assert.Equal(NodeState.InProgress, state["doing"]);

        _fields[OemFlow.LinkedSku] = null;
        Assert.Throws<FlowException>(() => _engine.Confirm(state, "doing", new Actor("开发"), _fields));

        _fields[OemFlow.LinkedSku] = "SKU-001";
        _engine.Confirm(state, "doing", new Actor("开发"), _fields);
        Assert.Equal(NodeState.Completed, state["doing"]);
    }

    [Fact]
    public void Turning_off_phase_out_skips_its_branch_and_project_review_waits_only_on_scheduling()
    {
        _fields[OemFlow.NeedPhaseOut] = "否";
        _fields[OemFlow.NeedLaunchPlan] = "否";
        var state = Start();
        Pass(state, "doing", "state_51", "end");

        foreach (var key in new[] { "state_53", "state_54", "state_55", "state_56", "state_0" })
            Assert.Equal(NodeState.Skipped, state[key]);
        Assert.Equal(NodeState.NotStarted, state["state_2"]);

        Pass(state, "state_1");
        Assert.Equal(NodeState.InProgress, state["state_2"]);
    }

    [Fact]
    public void Formula_lock_auto_completes_when_field_becomes_Y_and_members_cannot_force_it()
    {
        var state = Start();
        Pass(state, "doing", "state_51", "end", "state_1", "state_53", "state_54", "state_55", "state_56", "state_0",
            "state_2", "state_3", "state_5");

        Assert.Equal(NodeState.InProgress, state["formulalocked"]);
        Assert.Throws<FlowException>(() => _engine.Confirm(state, "formulalocked", new Actor("NPD"), _fields));

        _fields[OemFlow.FormulaLocked] = "Y";
        _engine.OnFieldsChanged(state, _fields);

        Assert.Equal(NodeState.Completed, state["formulalocked"]);
        foreach (var key in new[] { "state_7", "state_9", "wdxtest", "gxtest" })
            Assert.Equal(NodeState.InProgress, state[key]);
    }

    [Fact]
    public void Launch_review_fans_out_to_five_nodes()
    {
        var state = Start();
        Pass(state, "doing", "state_51", "end", "state_1", "state_53", "state_54", "state_55", "state_56", "state_0",
            "state_2", "state_16");
        // 相容性测试、产品成本确认、安评送检没有卡点，到达即自动完成
        Pass(state, "state_20", "state_23", "state_26");

        foreach (var key in new[] { "state_27", "state_29", "state_28", "state_30", "state_44" })
            Assert.Equal(NodeState.InProgress, state[key]);
        Assert.Equal("上市阶段", state.Stage);
    }

    [Fact]
    public void Legal_review_waits_for_both_assets_unless_video_is_turned_off()
    {
        var state = Start();
        Pass(state, "doing", "state_51", "end", "state_1", "state_53", "state_54", "state_55", "state_56", "state_0",
            "state_2", "state_16", "state_20", "state_23", "state_26", "state_30", "state_40");
        Assert.Equal(NodeState.NotStarted, state["state_43"]);

        _fields[OemFlow.NeedVideo] = "否";
        _engine.OnFieldsChanged(state, _fields);

        Assert.Equal(NodeState.Skipped, state["state_42"]);
        Assert.Equal(NodeState.InProgress, state["state_43"]);
    }

    [Fact]
    public void Project_completes_when_every_visible_leaf_is_done()
    {
        _fields[OemFlow.FormulaLocked] = "Y";
        var state = Start();

        // 反复推进所有进行中的节点，直到工作项完成或没有可推的节点
        for (var round = 0; round < 60 && state.Status == WorkItemStatus.InProgress; round++)
        {
            var open = state.Nodes.Where(n => n.Value.State == NodeState.InProgress).Select(n => n.Key).ToArray();
            Assert.NotEmpty(open);
            Pass(state, open.Where(k => state[k] == NodeState.InProgress).Take(1).ToArray());
        }

        Assert.Equal(WorkItemStatus.Completed, state.Status);
        Assert.Equal(NodeState.Skipped, state["state_25"]); // 概念测试被开关关掉
    }
}
