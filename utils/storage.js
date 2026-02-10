<<<<<<< ours
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
=======
const COLLECTION_NAME = 'poker_rounds';

function getCollection() {
  if (!wx.cloud) {
    throw new Error('当前基础库不支持云开发');
  }
  return wx.cloud.database().collection(COLLECTION_NAME);
}

async function getRounds() {
  const collection = getCollection();
  const { data = [] } = await collection.orderBy('createdAt', 'desc').get();
  return data.map((item) => ({ ...item, id: item._id }));
}

async function addRound(round) {
  const collection = getCollection();
  const payload = {
    ...round,
    createdAt: Date.now()
  };
  const result = await collection.add({
    data: payload
  });
  return {
    ...payload,
    id: result._id
  };
}

async function removeRoundById(id) {
  const collection = getCollection();
  await collection.doc(String(id)).remove();
}

async function clearRounds() {
  const rounds = await getRounds();
  if (!rounds.length) {
    return;
  }
  await Promise.all(rounds.map((round) => removeRoundById(round.id)));
}

module.exports = {
  COLLECTION_NAME,
  getRounds,
>>>>>>> theirs
  addRound,
  removeRoundById,
  clearRounds
};
