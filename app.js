App({
<<<<<<< ours
=======
  onLaunch() {
    if (!wx.cloud) {
      wx.showModal({
        title: '提示',
        content: '当前微信版本过低，无法使用云存储能力。'
      });
      return;
    }

    wx.cloud.init({
      traceUser: true
    });
  },

>>>>>>> theirs
  globalData: {
    appName: '打牌记账'
  }
});
