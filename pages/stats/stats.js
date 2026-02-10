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

<<<<<<< ours
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
=======
  async refreshData() {
    try {
      wx.showLoading({ title: '加载中' });
      const rounds = await getRounds();
      const { summary, ranking } = summarizeRounds(rounds);
      this.setData({ rounds, summary, ranking });
    } catch (error) {
      wx.showToast({ title: '加载失败，请检查云环境', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  removeRound(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '确认删除',
      content: '确认删除该局记录吗？',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          wx.showLoading({ title: '删除中' });
          await removeRoundById(id);
          wx.showToast({ title: '已删除' });
          await this.refreshData();
        } catch (error) {
          wx.showToast({ title: '删除失败，请检查云环境', icon: 'none' });
        } finally {
          wx.hideLoading();
        }
>>>>>>> theirs
      }
    });
  }
});
