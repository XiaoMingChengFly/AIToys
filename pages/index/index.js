const { addRound, clearRounds, getRounds } = require('../../utils/storage');
const { normalizePlayers, parseScore } = require('../../utils/round');

function createPlayer(id) {
  return {
    id,
    name: '',
    scoreText: ''
  };
}

Page({
  data: {
    roundName: '',
    date: '',
    note: '',
    players: [createPlayer(1), createPlayer(2), createPlayer(3), createPlayer(4)]
  },

  onLoad() {
    this.resetForm(true);
  },

  getToday() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  },

  resetForm(withDate = false) {
    this.setData({
      roundName: '',
      date: withDate ? this.getToday() : this.data.date,
      note: '',
      players: [createPlayer(1), createPlayer(2), createPlayer(3), createPlayer(4)]
    });
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [field]: e.detail.value });
  },

  onDateChange(e) {
    this.setData({ date: e.detail.value });
  },

  onPlayerInput(e) {
    const { id, field } = e.currentTarget.dataset;
    const targetId = Number(id);
    const players = this.data.players.map((player) => {
      if (player.id !== targetId) return player;
      if (field === 'name') {
        return { ...player, name: e.detail.value };
      }
      return { ...player, scoreText: e.detail.value };
    });
    this.setData({ players });
  },

  addPlayer() {
    const nextId = this.data.players.length
      ? Math.max(...this.data.players.map((player) => player.id)) + 1
      : 1;
    this.setData({ players: [...this.data.players, createPlayer(nextId)] });
  },

  removePlayer(e) {
    if (this.data.players.length <= 2) {
      wx.showToast({ title: '至少保留两位玩家', icon: 'none' });
      return;
    }
    const targetId = Number(e.currentTarget.dataset.id);
    const players = this.data.players.filter((player) => player.id !== targetId);
    this.setData({ players });
  },

  autoBalance() {
    const namedPlayers = this.data.players.filter((player) => String(player.name || '').trim());
    if (namedPlayers.length < 2) {
      wx.showToast({ title: '先填写至少两位玩家', icon: 'none' });
      return;
    }

    const total = namedPlayers.reduce((sum, player) => sum + parseScore(player.scoreText), 0);
    if (Math.abs(total) < 0.00001) {
      wx.showToast({ title: '当前已平账', icon: 'none' });
      return;
    }

    const lastPlayerId = namedPlayers[namedPlayers.length - 1].id;
    const players = this.data.players.map((player) => {
      if (player.id !== lastPlayerId) return player;
      const nextScore = parseScore(player.scoreText) - total;
      return { ...player, scoreText: String(nextScore) };
    });

    this.setData({ players });
    wx.showToast({ title: '已自动平账' });
  },

  saveRound() {
    const validPlayers = normalizePlayers(this.data.players);
    if (validPlayers.length < 2) {
      wx.showToast({ title: '至少输入两位玩家', icon: 'none' });
      return;
    }

    const names = validPlayers.map((player) => player.name);
    if (new Set(names).size !== names.length) {
      wx.showToast({ title: '玩家名不能重复', icon: 'none' });
      return;
    }

    const total = validPlayers.reduce((sum, player) => sum + player.score, 0);
    if (Math.abs(total) > 0.00001) {
      wx.showModal({
        title: '分数未平衡',
        content: `当前总分为 ${total}，继续保存？`,
        success: (res) => {
          if (!res.confirm) return;
          this.persistRound(validPlayers, total);
        }
      });
      return;
    }

    this.persistRound(validPlayers, total);
  },

  persistRound(validPlayers, total) {
    const roundCount = getRounds().length;
    const round = {
      id: Date.now(),
      roundName: this.data.roundName.trim() || `第 ${roundCount + 1} 局`,
      date: this.data.date,
      note: this.data.note.trim(),
      total,
      players: validPlayers
    };

    addRound(round);
    wx.showToast({ title: '已保存' });
    this.resetForm(true);
  },

  clearAll() {
    wx.showModal({
      title: '确认清空',
      content: '将删除所有历史局记录，无法恢复。',
      success: (res) => {
        if (!res.confirm) return;
        clearRounds();
        wx.showToast({ title: '已清空' });
      }
    });
  }
});
