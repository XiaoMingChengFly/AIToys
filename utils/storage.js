const STORAGE_KEY = 'poker_rounds';

function getRounds() {
  const rounds = wx.getStorageSync(STORAGE_KEY);
  return Array.isArray(rounds) ? rounds : [];
}

function setRounds(rounds) {
  wx.setStorageSync(STORAGE_KEY, rounds);
}

function addRound(round) {
  const rounds = getRounds();
  rounds.unshift(round);
  setRounds(rounds);
  return rounds;
}

function removeRoundById(id) {
  const rounds = getRounds().filter((round) => round.id !== id);
  setRounds(rounds);
  return rounds;
}

function clearRounds() {
  wx.removeStorageSync(STORAGE_KEY);
}

module.exports = {
  STORAGE_KEY,
  getRounds,
  setRounds,
  addRound,
  removeRoundById,
  clearRounds
};
