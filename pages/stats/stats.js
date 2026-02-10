const { getRounds, removeRoundById } = require('../../utils/storage');
const { summarizeRounds } = require('../../utils/round');

Page({
  data: {
    rounds: [],
    summary: {
      roundCount: 0,
      entryCount: 0,
      totalScore: 0
    },
    ranking: []
  },

  onShow() {
    this.refreshData();
  },

  refreshData() {
    const rounds = getRounds();
    const { summary, ranking } = summarizeRounds(rounds);
    this.setData({ rounds, summary, ranking });
  },

  removeRound(e) {
    const id = Number(e.currentTarget.dataset.id);
    wx.showModal({
      title: '确认删除',
      content: '确认删除该局记录吗？',
      success: (res) => {
        if (!res.confirm) return;
        removeRoundById(id);
        wx.showToast({ title: '已删除' });
        this.refreshData();
      }
    });
  }
});
