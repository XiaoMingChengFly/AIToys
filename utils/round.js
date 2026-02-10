function parseScore(raw) {
  if (raw === '' || raw === null || raw === undefined) {
    return 0;
  }
  const num = Number(raw);
  return Number.isFinite(num) ? num : 0;
}

function normalizePlayers(players) {
  return players
    .filter((player) => String(player.name || '').trim())
    .map((player) => ({
      name: String(player.name).trim(),
      score: parseScore(player.scoreText !== undefined ? player.scoreText : player.score)
    }));
}

function summarizeRounds(rounds) {
  const playerMap = {};
  let entryCount = 0;
  let totalScore = 0;

  rounds.forEach((round) => {
    (round.players || []).forEach((player) => {
      const score = parseScore(player.score);
      const name = String(player.name || '').trim();
      if (!name) return;

      entryCount += 1;
      totalScore += score;

      if (!playerMap[name]) {
        playerMap[name] = {
          total: 0,
          rounds: 0
        };
      }
      playerMap[name].total += score;
      playerMap[name].rounds += 1;
    });
  });

  const ranking = Object.keys(playerMap)
    .map((name) => ({
      name,
      total: playerMap[name].total,
      rounds: playerMap[name].rounds
    }))
    .sort((a, b) => b.total - a.total);

  return {
    summary: {
      roundCount: rounds.length,
      entryCount,
      totalScore
    },
    ranking
  };
}

module.exports = {
  parseScore,
  normalizePlayers,
  summarizeRounds
};
