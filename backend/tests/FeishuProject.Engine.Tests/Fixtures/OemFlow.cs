using FeishuProject.Engine.Flow;
using static FeishuProject.Engine.Flow.CompletionMode;

namespace FeishuProject.Engine.Tests.Fixtures;

/// <summary>
/// 飞书项目 oemtest 空间「项目 → OEM v289」流程模板，2026-10-20 只读提取。
/// 节点键与飞书一致（例如「需求评审」的键是 end，「需求立项提案」是 doing），按键对应，不按名称。
/// 没有卡点的自动节点（相容性测试、产品成本确认、安评送检）在飞书里由外部条件推动，这里按“到达即完成”处理。
/// </summary>
public static class OemFlow
{
    public const string NeedPhaseOut = "是否需要迭代老品下市物料风险评估";
    public const string NeedLaunchPlan = "是否需要产品上市计划";
    public const string NeedConceptTest = "是否需要概念测试";
    public const string NeedVideo = "是否需要视频拍摄制作";
    public const string FormulaLocked = "配方是否锁定";
    public const string NeedFiling = "是否需要备案";
    public const string LinkedSku = "关联需求SKU流程";

    private const string Concept = "概念阶段", Plan = "计划阶段", Dev = "开发阶段", Launch = "上市阶段", Review = "复盘阶段";

    public static FlowDefinition Definition { get; } = Build();

    private static FlowDefinition Build()
    {
        var nodes = new List<NodeDefinition>();
        var edges = new List<EdgeDefinition>();

        void N(string key, string name, string[] preds, CompletionMode mode = SingleConfirm, string[]? roles = null,
            Condition? visible = null, Condition? gate = null, string? stage = null)
        {
            nodes.Add(new NodeDefinition(key, name, mode, roles, visible, gate, stage));
            edges.AddRange(preds.Select(p => new EdgeDefinition(p, key)));
        }

        var phaseOut = Condition.Equal(NeedPhaseOut, "是");

        N("start", "开始", [], Auto, ["NPD"], stage: Concept);
        N("doing", "需求立项提案", ["start"], AllConfirm, ["NPD", "财务BP负责人", "开发"],
            gate: Condition.NotEmpty(LinkedSku), stage: Concept);
        N("state_51", "财务分析（需求立项）", ["doing"], roles: ["财务BP"], stage: Concept);
        N("end", "需求评审", ["state_51"], SubItemDriven, stage: Concept);
        N("state_1", "产品入库预排期", ["end"], roles: ["开发"], stage: Plan);
        N("state_53", "迭代下市成品清单", ["end"], roles: ["DP"], visible: phaseOut);
        N("state_54", "迭代下市物料盘点-PC", ["state_53"], roles: ["PC"], visible: phaseOut);
        N("state_55", "迭代下市物料盘点-战采", ["state_53"], roles: ["战略采购-包材成品"], visible: phaseOut);
        N("state_56", "迭代下市物料盘点-MP", ["state_53"], roles: ["MP"], visible: Condition.Equal(NeedLaunchPlan, "是"));
        N("state_0", "迭代老品下市物料风险评估", ["state_54", "state_55", "state_56"], roles: ["PC", "战略采购-包材成品"],
            visible: phaseOut, stage: Plan);
        N("state_2", "项目评审", ["state_1", "state_0"], SubItemDriven, stage: Plan);
        N("state_3", "产品料体试用", ["state_2"], SubItemDriven, stage: Dev);
        N("state_16", "内外包开发", ["state_2"], SubItemDriven, stage: Dev);
        N("state_59", "包装设计Brief提交", ["state_2"], AllConfirm, ["NPD"]);
        N("state_60", "财务模具预算", ["state_2"], roles: ["财务BP"]);
        N("state_4", "配方成本初步核算", ["state_3"], roles: ["战略采购-原料"], stage: Plan);
        N("state_5", "放大样测试", ["state_3"], SubItemDriven, stage: Dev);
        N("state_19", "相容性测试（自动完成）", ["state_16"], Auto, stage: Dev);
        N("formulalocked", "配方锁定", ["state_5"], Auto, gate: Condition.Equal(FormulaLocked, "Y"), stage: Dev);
        N("state_24", "产品成本确认（自动完成）", ["state_19"], Auto, stage: Dev);
        N("apsj", "安评送检", ["state_19"], Auto, stage: Dev);
        N("state_7", "配方预成本核算", ["formulalocked"], roles: ["战略采购-原料"], stage: Dev);
        N("state_9", "配方原料可供周期评估", ["formulalocked"], roles: ["战略采购-原料"], stage: Dev);
        N("wdxtest", "稳定性测试", ["formulalocked"], SubItemDriven, stage: Dev);
        N("gxtest", "功效测试", ["formulalocked"], SubItemDriven, stage: Dev);
        N("state_20", "产品价格机制及首单量提报", ["state_24"], roles: ["TM"], stage: Dev);
        N("state_25", "概念测试", ["state_24"], roles: ["洞察"], visible: Condition.Equal(NeedConceptTest, "是"));
        N("filing", "备案", ["apsj"], Auto, gate: Condition.Equal(NeedFiling, "是"));
        N("state_23", "财务分析", ["state_20"], roles: ["财务BP"], stage: Dev);
        N("state_46", "产品上市360计划制定（如有）", ["state_20"], roles: ["GTM"],
            visible: Condition.Equal(NeedLaunchPlan, "是"), stage: Launch);
        N("state_57", "产品尺寸确认", ["state_20"], roles: ["NPD"]);
        N("state_21", "标准签发", ["filing"], roles: ["质量合规"], stage: Dev);
        N("state_26", "上市评审", ["state_23"], SubItemDriven);
        N("state_58", "纸箱编码确认", ["state_57"], roles: ["物流部负责人"]);
        N("state_27", "产品链接承接方式", ["state_26"], roles: ["TM"], stage: Launch);
        N("state_29", "达人试用反馈收集", ["state_26"], roles: ["媒介"], stage: Launch);
        N("state_28", "原料入库", ["state_26"], roles: ["PC"], stage: Launch);
        N("state_30", "产品fact sheet知识库输出", ["state_26"], roles: ["NPD"], stage: Launch);
        N("state_44", "各渠道机制上市前确认", ["state_26"], roles: ["TM"], stage: Launch);
        N("state_52", "成品到仓入库", ["state_28"], roles: ["DP"]);
        N("state_31", "产品资料撰写", ["state_30"], SubItemDriven, stage: Launch);
        N("state_37", "产品Q&A撰写及知识库录入", ["state_30"], roles: ["GTM"], stage: Launch);
        N("state_40", "产品平面素材", ["state_30"], SubItemDriven, stage: Launch);
        N("state_42", "视频拍摄制作", ["state_30"], SubItemDriven, visible: Condition.Equal(NeedVideo, "是"), stage: Launch);
        N("state_36", "KOL Brief产品介绍/KOL Brief撰稿需求", ["state_31"], roles: ["媒介"], stage: Launch);
        N("state_43", "所有对外资料法务审核", ["state_42", "state_40"], roles: ["法务", "GTM"], stage: Launch);
        N("state_45", "各渠道新品上架", ["state_44", "state_43"], roles: ["TM"], stage: Launch);
        N("state_47", "客诉监控", ["state_45"], roles: ["GTM"], stage: Review);

        return new FlowDefinition("oem", 289, nodes, edges);
    }

    /// <summary>每个有负责角色的节点，指定一个同名用户做负责人，便于测试里按角色确认。</summary>
    public static IReadOnlyDictionary<string, IReadOnlyList<string>> OwnersByRole() =>
        Definition.Nodes.Where(n => n.OwnerRoles.Count > 0)
            .ToDictionary(n => n.Key, n => (IReadOnlyList<string>)n.OwnerRoles.ToList());
}
